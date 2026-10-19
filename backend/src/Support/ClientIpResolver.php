<?php

declare(strict_types=1);

namespace App\Support;

use App\Models\NetworkProfile;

class ClientIpResolver
{
    private const CANDIDATE_HEADERS = [
        'HTTP_X_NF_CLIENT_CONNECTION_IP' => 'x-nf-client-connection-ip',
        'HTTP_CF_CONNECTING_IP'          => 'cf-connecting-ip',
        'HTTP_TRUE_CLIENT_IP'           => 'true-client-ip',
        'HTTP_X_REAL_IP'                => 'x-real-ip',
        'HTTP_X_FORWARDED_FOR'          => 'x-forwarded-for',
        'HTTP_X_VERCEL_FORWARDED_FOR'   => 'x-vercel-forwarded-for',
        'HTTP_FORWARDED'                => 'forwarded',
        'REMOTE_ADDR'                   => 'remote-addr',
    ];

    public static function resolve(): array
    {
        foreach (self::CANDIDATE_HEADERS as $serverKey => $headerName) {
            if (!empty($_SERVER[$serverKey])) {
                $raw = (string)$_SERVER[$serverKey];
                $ip = self::parseIpFromHeaderValue($raw);
                if ($ip) {
                    return ['ip' => $ip, 'source' => $headerName];
                }
            }
        }

        return ['ip' => null, 'source' => null];
    }

    public static function cleanCandidate(string $value): ?string
    {
        $candidate = trim($value);
        if (!$candidate) {
            return null;
        }

        $candidate = preg_replace('/^for=/i', '', $candidate);
        $candidate = trim($candidate);
        $candidate = preg_replace('/^"(.+)"$/', '$1', $candidate);

        $semicolonPos = strpos($candidate, ';');
        if ($semicolonPos !== false) {
            $candidate = substr($candidate, 0, $semicolonPos);
            $candidate = trim($candidate);
        }

        if (str_starts_with($candidate, '[')) {
            $endBracket = strpos($candidate, ']');
            if ($endBracket !== false) {
                $candidate = substr($candidate, 1, $endBracket - 1);
            }
        }

        if (str_contains($candidate, '.') && str_contains($candidate, ':')) {
            $parts = explode(':', $candidate);
            $candidate = $parts[0];
        }

        $zonePos = strpos($candidate, '%');
        if ($zonePos !== false) {
            $candidate = substr($candidate, 0, $zonePos);
        }

        return NetworkProfile::detectIpFamily($candidate) ? $candidate : null;
    }

    public static function parseIpFromHeaderValue(string $raw): ?string
    {
        $parts = explode(',', $raw);
        foreach ($parts as $part) {
            if (preg_match('/for=(?:"?\[?([0-9a-fA-F:.%]+)\]?"?)/i', $part, $matches)) {
                $fromForwarded = self::cleanCandidate($matches[1]);
                if ($fromForwarded) {
                    return $fromForwarded;
                }
            }

            $direct = self::cleanCandidate($part);
            if ($direct) {
                return $direct;
            }
        }
        return null;
    }
}
