<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\NetworkProfile;

class ProviderExtractor
{
    public static function pickString(?array $record, array $keys): ?string
    {
        if (!$record) {
            return null;
        }
        foreach ($keys as $key) {
            if (isset($record[$key]) && is_string($record[$key])) {
                $trimmed = trim($record[$key]);
                if ($trimmed !== '') {
                    return $trimmed;
                }
            }
        }
        return null;
    }

    public static function pickCoordinate(?array $record, array $keys): ?float
    {
        if (!$record) {
            return null;
        }
        foreach ($keys as $key) {
            if (isset($record[$key])) {
                $coord = NetworkProfile::parseCoordinate($record[$key]);
                if ($coord !== null) {
                    return $coord;
                }
            }
        }
        return null;
    }

    public static function normalizeIpCandidate(?string $value): array
    {
        if (!$value) {
            return [];
        }
        $family = NetworkProfile::detectIpFamily($value);
        if ($family === 'IPv4') {
            return ['ipv4' => $value];
        }
        if ($family === 'IPv6') {
            return ['ipv6' => $value];
        }
        return [];
    }

    /**
     * Parses Cloudflare trace output (key=value lines like ip=..., loc=IR).
     */
    public static function parseCloudflareTrace(string $text, bool $extractCountry = true): array
    {
        $lines = explode("\n", $text);
        $result = [];

        foreach ($lines as $line) {
            $line = trim($line);
            if (!$line || !str_contains($line, '=')) {
                continue;
            }
            [$key, $val] = explode('=', $line, 2);
            $key = trim($key);
            $val = trim($val);

            if ($key === 'ip') {
                $result = array_merge($result, self::normalizeIpCandidate($val));
            } elseif ($key === 'loc' && $extractCountry) {
                $country = NetworkProfile::normalizeCountry($val);
                if ($country) {
                    $result['country'] = $country;
                }
            }
        }

        return $result;
    }

    public static function extractFromJson(string $providerId, ?array $record): array
    {
        if (!$record) {
            return [];
        }

        // ipify
        if (str_starts_with($providerId, 'ipify-')) {
            return self::normalizeIpCandidate(self::pickString($record, ['ip']));
        }

        // country.is
        if (str_starts_with($providerId, 'countryis-')) {
            $ip = self::pickString($record, ['ip']);
            $country = self::pickString($record, ['country']);
            return array_merge(
                self::normalizeIpCandidate($ip),
                ['country' => NetworkProfile::normalizeCountry($country)]
            );
        }

        // seeip json
        if ($providerId === 'seeip-json') {
            return self::normalizeIpCandidate(self::pickString($record, ['ip']));
        }

        // seeip geoip
        if (str_starts_with($providerId, 'seeip-geo')) {
            $ip = self::pickString($record, ['ip']);
            return array_merge(
                self::normalizeIpCandidate($ip),
                [
                    'city' => self::pickString($record, ['city']),
                    'country' => self::pickString($record, ['country', 'country_code']),
                    'lat' => self::pickCoordinate($record, ['latitude', 'lat']),
                    'lon' => self::pickCoordinate($record, ['longitude', 'lon']),
                ]
            );
        }

        // ipwho.is
        if (str_starts_with($providerId, 'ipwhois-geo')) {
            $connection = isset($record['connection']) && is_array($record['connection']) ? $record['connection'] : [];
            $ip = self::pickString($record, ['ip']);
            $country = self::pickString($record, ['country', 'country_name', 'countryCode', 'country_code']);
            return array_merge(
                self::normalizeIpCandidate($ip),
                [
                    'isp' => self::pickString($connection, ['isp', 'org', 'organization']),
                    'city' => self::pickString($record, ['city']),
                    'country' => $country,
                    'lat' => self::pickCoordinate($record, ['latitude', 'lat']),
                    'lon' => self::pickCoordinate($record, ['longitude', 'lon']),
                ]
            );
        }

        // ip-api.com
        if (str_starts_with($providerId, 'ipapi-http')) {
            $status = self::pickString($record, ['status']);
            if ($status && strtolower($status) === 'fail') {
                return [];
            }
            $ip = self::pickString($record, ['query', 'ip']);
            return array_merge(
                self::normalizeIpCandidate($ip),
                [
                    'isp' => self::pickString($record, ['isp', 'org', 'as']),
                    'city' => self::pickString($record, ['city', 'regionName']),
                    'country' => self::pickString($record, ['country', 'countryCode']),
                    'lat' => self::pickCoordinate($record, ['lat', 'latitude']),
                    'lon' => self::pickCoordinate($record, ['lon', 'longitude']),
                ]
            );
        }

        // ipquery.io
        if (str_starts_with($providerId, 'ipquery-geo')) {
            $location = isset($record['location']) && is_array($record['location']) ? $record['location'] : [];
            $ispRecord = isset($record['isp']) && is_array($record['isp']) ? $record['isp'] : [];
            $ip = self::pickString($record, ['ip']);
            return array_merge(
                self::normalizeIpCandidate($ip),
                [
                    'isp' => self::pickString($ispRecord, ['org', 'isp', 'asn']),
                    'city' => self::pickString($location, ['city', 'state']),
                    'country' => self::pickString($location, ['country', 'country_code']),
                    'lat' => self::pickCoordinate($location, ['latitude', 'lat']),
                    'lon' => self::pickCoordinate($location, ['longitude', 'lon']),
                ]
            );
        }

        // api.ip.sb/geoip
        if (str_starts_with($providerId, 'ipsb-geo')) {
            $ip = self::pickString($record, ['ip']);
            return array_merge(
                self::normalizeIpCandidate($ip),
                [
                    'isp' => self::pickString($record, ['isp', 'organization', 'asn_organization']),
                    'city' => self::pickString($record, ['city', 'region']),
                    'country' => self::pickString($record, ['country', 'country_name', 'country_code']),
                    'lat' => self::pickCoordinate($record, ['latitude', 'lat']),
                    'lon' => self::pickCoordinate($record, ['longitude', 'lon']),
                ]
            );
        }

        // ipwhois.app
        if (str_starts_with($providerId, 'ipwhoisapp-geo')) {
            $ip = self::pickString($record, ['ip']);
            return array_merge(
                self::normalizeIpCandidate($ip),
                [
                    'isp' => self::pickString($record, ['isp', 'org', 'organization']),
                    'city' => self::pickString($record, ['city', 'region']),
                    'country' => self::pickString($record, ['country', 'country_code']),
                    'lat' => self::pickCoordinate($record, ['latitude', 'lat']),
                    'lon' => self::pickCoordinate($record, ['longitude', 'lon']),
                ]
            );
        }

        // ipapi.is
        if (str_starts_with($providerId, 'ipapiis-geo')) {
            $location = isset($record['location']) && is_array($record['location']) ? $record['location'] : [];
            $company = isset($record['company']) && is_array($record['company']) ? $record['company'] : [];
            $ip = self::pickString($record, ['ip']);
            return array_merge(
                self::normalizeIpCandidate($ip),
                [
                    'isp' => self::pickString($company, ['name']) ?? self::pickString($record, ['asn_org']),
                    'city' => self::pickString($location, ['city', 'state']),
                    'country' => self::pickString($location, ['country', 'country_code']),
                    'lat' => self::pickCoordinate($location, ['latitude', 'lat']),
                    'lon' => self::pickCoordinate($location, ['longitude', 'lon']),
                ]
            );
        }

        // ipinfo.io
        if (str_starts_with($providerId, 'ipinfo-geo')) {
            $ip = self::pickString($record, ['ip']);
            $loc = NetworkProfile::parseLocPair(self::pickString($record, ['loc']));
            return array_merge(
                self::normalizeIpCandidate($ip),
                [
                    'isp' => self::pickString($record, ['org']),
                    'city' => self::pickString($record, ['city', 'region']),
                    'country' => self::pickString($record, ['country']),
                    'lat' => $loc['lat'],
                    'lon' => $loc['lon'],
                ]
            );
        }

        return [];
    }

    public static function extractFromText(string $providerId, string $text, bool $extractCountry = true): array
    {
        $value = trim($text);
        if ($value === '') {
            return [];
        }

        if ($providerId === 'cloudflare-1111' || $providerId === 'cloudflare-trace') {
            return self::parseCloudflareTrace($text, $extractCountry);
        }

        return self::normalizeIpCandidate($value);
    }
}
