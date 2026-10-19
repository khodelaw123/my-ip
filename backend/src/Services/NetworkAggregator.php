<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\NetworkProfile;
use App\Support\ClientIpResolver;
use App\Support\ProviderRegistry;

class NetworkAggregator
{
    public static function buildProviderQueue(?string $clientIp): array
    {
        if ($clientIp) {
            $encodedIp = urlencode($clientIp);
            $targeted = ProviderRegistry::getTargetedGeoProviders($encodedIp);
            $base = ProviderRegistry::getBaseIpProviders();
            return array_merge($targeted, $base);
        }

        $base = ProviderRegistry::getBaseIpProviders();
        $untargeted = ProviderRegistry::getUntargetedGeoProviders();
        return array_merge($base, $untargeted);
    }

    public static function execute(): array
    {
        $hint = ClientIpResolver::resolve();
        $hintedIp = $hint['ip'];
        $hintSource = $hint['source'];

        $providers = self::buildProviderQueue($hintedIp);

        $profile = new NetworkProfile();
        $sourcesUsed = [];
        $hasHintedIp = false;

        if ($hintedIp) {
            $seeded = ProviderExtractor::normalizeIpCandidate($hintedIp);
            $profile->merge($seeded);
            $sourcesUsed[] = 'request-header:' . ($hintSource ?? 'ip-hint');
            $hasHintedIp = true;
        }

        if (extension_loaded('curl')) {
            $result = self::runAsyncCurl($providers, $profile, $sourcesUsed, $hasHintedIp);
        } else {
            $result = self::runStreamFallback($providers, $profile, $sourcesUsed, $hasHintedIp);
        }

        return [
            'success' => $result['profile']->hasAtLeastOneIp(),
            'data' => array_merge(
                $result['profile']->toArray(),
                ['sourcesUsed' => array_values(array_unique($result['sourcesUsed']))]
            ),
            'diagnostics' => [
                'attempted' => $result['attempted'],
                'failures' => $result['failures'],
            ],
        ];
    }

    private static function runAsyncCurl(
        array $providers,
        NetworkProfile $profile,
        array $sourcesUsed,
        bool $hasHintedIp
    ): array {
        $mh = curl_multi_init();
        $deadline = microtime(true) + ProviderRegistry::OVERALL_TIMEOUT_SECONDS;
        $attempted = [];
        $failures = [];
        $sourcesUsedSet = array_flip($sourcesUsed);

        $totalProviders = count($providers);
        $providerIndex = 0;
        $activeHandles = [];

        $addNextHandle = function () use (
            $mh,
            $providers,
            &$providerIndex,
            $totalProviders,
            &$activeHandles,
            &$attempted,
            $deadline
        ) {
            if ($providerIndex >= $totalProviders || microtime(true) >= $deadline) {
                return false;
            }

            $provider = $providers[$providerIndex++];
            $attempted[] = $provider['id'];

            $ch = curl_init();
            $remaining = $deadline - microtime(true);
            $timeout = max(1, (int)min(ProviderRegistry::PROVIDER_TIMEOUT_SECONDS, $remaining));

            curl_setopt_array($ch, [
                CURLOPT_URL => $provider['url'],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_TIMEOUT => $timeout,
                CURLOPT_CONNECTTIMEOUT => 2,
                CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_SSL_VERIFYHOST => 0,
            ]);

            curl_multi_add_handle($mh, $ch);
            $handleId = (int)$ch;
            $activeHandles[$handleId] = [
                'ch' => $ch,
                'provider' => $provider,
            ];
            return true;
        };

        // Fill initial batch up to concurrency limit
        while (count($activeHandles) < ProviderRegistry::CONCURRENCY_LIMIT && $addNextHandle()) {
            // continue filling
        }

        $stop = false;

        do {
            $status = curl_multi_exec($mh, $running);

            if ($status > 0) {
                break;
            }

            // Read completed requests
            while ($info = curl_multi_info_read($mh)) {
                $completedCh = $info['handle'];
                $handleId = (int)$completedCh;

                if (isset($activeHandles[$handleId])) {
                    $provider = $activeHandles[$handleId]['provider'];
                    $httpCode = curl_getinfo($completedCh, CURLINFO_HTTP_CODE);
                    $responseBody = curl_multi_getcontent($completedCh);

                    if ($info['result'] === CURLE_OK && $httpCode >= 200 && $httpCode < 300 && is_string($responseBody)) {
                        $partial = [];
                        $isTargeted = str_contains($provider['id'], '-targeted');

                        if ($provider['format'] === 'json') {
                            $decoded = json_decode($responseBody, true);
                            if (is_array($decoded)) {
                                $partial = ProviderExtractor::extractFromJson($provider['id'], $decoded);
                            }
                        } else {
                            $extractCountry = !$hasHintedIp;
                            $partial = ProviderExtractor::extractFromText($provider['id'], $responseBody, $extractCountry);
                        }

                        // Prevent untargeted server datacenter geo from overriding the client
                        if ($hasHintedIp && !$isTargeted) {
                            unset(
                                $partial['country'],
                                $partial['city'],
                                $partial['lat'],
                                $partial['lon'],
                                $partial['isp']
                            );
                        }

                        $before = $profile->toArray();
                        $profile->merge($partial);
                        $after = $profile->toArray();

                        if (
                            $after['ipv4'] !== $before['ipv4'] ||
                            $after['ipv6'] !== $before['ipv6'] ||
                            $after['isp'] !== $before['isp'] ||
                            $after['city'] !== $before['city'] ||
                            $after['country'] !== $before['country'] ||
                            $after['lat'] !== $before['lat'] ||
                            $after['lon'] !== $before['lon']
                        ) {
                            $sourcesUsedSet[$provider['id']] = true;
                        }

                        if ($profile->shouldStopEarly()) {
                            $stop = true;
                        }
                    } else {
                        $reason = $info['result'] !== CURLE_OK
                            ? curl_strerror($info['result'])
                            : "http-{$httpCode}";
                        $failures[] = ['source' => $provider['id'], 'reason' => $reason];
                    }

                    curl_multi_remove_handle($mh, $completedCh);
                    if (PHP_VERSION_ID < 80500) {
                        @curl_close($completedCh);
                    }
                    unset($activeHandles[$handleId]);

                    if (!$stop && microtime(true) < $deadline) {
                        $addNextHandle();
                    }
                }
            }

            if ($stop) {
                break;
            }

            if ($running > 0) {
                curl_multi_select($mh, 0.05);
            }
        } while (($running > 0 || count($activeHandles) > 0) && microtime(true) < $deadline);

        foreach ($activeHandles as $handle) {
            curl_multi_remove_handle($mh, $handle['ch']);
            if (PHP_VERSION_ID < 80500) {
                @curl_close($handle['ch']);
            }
        }
        curl_multi_close($mh);

        return [
            'profile' => $profile,
            'attempted' => $attempted,
            'failures' => $failures,
            'sourcesUsed' => array_keys($sourcesUsedSet),
        ];
    }

    private static function runStreamFallback(
        array $providers,
        NetworkProfile $profile,
        array $sourcesUsed,
        bool $hasHintedIp
    ): array {
        $deadline = microtime(true) + ProviderRegistry::OVERALL_TIMEOUT_SECONDS;
        $attempted = [];
        $failures = [];
        $sourcesUsedSet = array_flip($sourcesUsed);

        foreach ($providers as $provider) {
            if (microtime(true) >= $deadline || $profile->shouldStopEarly()) {
                break;
            }

            $attempted[] = $provider['id'];
            $remaining = $deadline - microtime(true);
            $timeout = max(1, (int)min(ProviderRegistry::PROVIDER_TIMEOUT_SECONDS, $remaining));

            $ctx = stream_context_create([
                'http' => [
                    'timeout' => $timeout,
                    'user_agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'ignore_errors' => true,
                ],
                'ssl' => [
                    'verify_peer' => false,
                    'verify_peer_name' => false,
                ],
            ]);

            $content = @file_get_contents($provider['url'], false, $ctx);
            if ($content === false) {
                $failures[] = ['source' => $provider['id'], 'reason' => 'stream-failed'];
                continue;
            }

            $partial = [];
            $isTargeted = str_contains($provider['id'], '-targeted');

            if ($provider['format'] === 'json') {
                $decoded = json_decode($content, true);
                if (is_array($decoded)) {
                    $partial = ProviderExtractor::extractFromJson($provider['id'], $decoded);
                }
            } else {
                $extractCountry = !$hasHintedIp;
                $partial = ProviderExtractor::extractFromText($provider['id'], $content, $extractCountry);
            }

            if ($hasHintedIp && !$isTargeted) {
                unset(
                    $partial['country'],
                    $partial['city'],
                    $partial['lat'],
                    $partial['lon'],
                    $partial['isp']
                );
            }

            $before = $profile->toArray();
            $profile->merge($partial);
            $after = $profile->toArray();

            if (
                $after['ipv4'] !== $before['ipv4'] ||
                $after['ipv6'] !== $before['ipv6'] ||
                $after['isp'] !== $before['isp'] ||
                $after['city'] !== $before['city'] ||
                $after['country'] !== $before['country'] ||
                $after['lat'] !== $before['lat'] ||
                $after['lon'] !== $before['lon']
            ) {
                $sourcesUsedSet[$provider['id']] = true;
            }
        }

        return [
            'profile' => $profile,
            'attempted' => $attempted,
            'failures' => $failures,
            'sourcesUsed' => array_keys($sourcesUsedSet),
        ];
    }
}
