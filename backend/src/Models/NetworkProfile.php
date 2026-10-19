<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\ProviderRegistry;

class NetworkProfile
{
    public ?string $ipv4 = null;
    public ?string $ipv6 = null;
    public ?string $isp = null;
    public ?string $city = null;
    public ?string $country = null;
    public ?float $lat = null;
    public ?float $lon = null;

    public function toArray(): array
    {
        return [
            'ipv4' => $this->ipv4,
            'ipv6' => $this->ipv6,
            'isp' => $this->isp,
            'city' => $this->city,
            'country' => $this->country,
            'lat' => $this->lat,
            'lon' => $this->lon,
        ];
    }

    private static function toLower(string $value): string
    {
        return function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
    }

    private static function strLen(string $value): int
    {
        return function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
    }

    public static function parseCoordinate($value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (is_numeric($value)) {
            $floatVal = (float)$value;
            return is_finite($floatVal) ? $floatVal : null;
        }
        return null;
    }

    public static function isValidIPv4(string $value): bool
    {
        return filter_var($value, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false;
    }

    public static function isValidIPv6(string $value): bool
    {
        return filter_var($value, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false;
    }

    public static function detectIpFamily(?string $value): ?string
    {
        if (!$value) {
            return null;
        }
        $ip = trim($value);
        if (!$ip) {
            return null;
        }
        if (self::isValidIPv4($ip)) {
            return 'IPv4';
        }
        if (self::isValidIPv6($ip)) {
            return 'IPv6';
        }
        return null;
    }

    public static function isMeaningfulText(?string $value): bool
    {
        if ($value === null) {
            return false;
        }
        $trimmed = trim($value);
        if ($trimmed === '') {
            return false;
        }
        return !in_array(self::toLower($trimmed), ProviderRegistry::GENERIC_TEXT_VALUES, true);
    }

    public static function normalizeCountry(?string $value): ?string
    {
        if (!$value) {
            return null;
        }
        $trimmed = trim($value);
        if (!$trimmed) {
            return null;
        }
        $upper = strtoupper($trimmed);
        if (preg_match('/^[A-Z]{2}$/', $upper)) {
            return ProviderRegistry::COUNTRY_CODE_MAP[$upper] ?? $upper;
        }
        return $trimmed;
    }

    public static function parseLocPair(?string $value): array
    {
        if (!$value) {
            return ['lat' => null, 'lon' => null];
        }
        $parts = explode(',', $value);
        return [
            'lat' => self::parseCoordinate(isset($parts[0]) ? trim($parts[0]) : null),
            'lon' => self::parseCoordinate(isset($parts[1]) ? trim($parts[1]) : null),
        ];
    }

    public static function chooseBetterIsp(?string $current, ?string $next): ?string
    {
        $currentOk = self::isMeaningfulText($current);
        $nextOk = self::isMeaningfulText($next);

        if (!$currentOk && $nextOk) {
            return trim($next);
        }
        if ($currentOk && !$nextOk) {
            return trim($current);
        }
        if ($currentOk && $nextOk) {
            return self::strLen(trim($next)) > self::strLen(trim($current))
                ? trim($next)
                : trim($current);
        }

        $c = $current ? trim($current) : '';
        $n = $next ? trim($next) : '';
        return $c !== '' ? $c : ($n !== '' ? $n : null);
    }

    public function merge(array $incoming): self
    {
        if (isset($incoming['ipv4']) && !$this->ipv4 && self::detectIpFamily($incoming['ipv4']) === 'IPv4') {
            $this->ipv4 = trim($incoming['ipv4']);
        }
        if (isset($incoming['ipv6']) && !$this->ipv6 && self::detectIpFamily($incoming['ipv6']) === 'IPv6') {
            $this->ipv6 = trim($incoming['ipv6']);
        }
        if (isset($incoming['city']) && !$this->city && self::isMeaningfulText($incoming['city'])) {
            $this->city = trim($incoming['city']);
        }
        if (isset($incoming['country']) && !$this->country) {
            $normalized = self::normalizeCountry($incoming['country']);
            if ($normalized) {
                $this->country = $normalized;
            }
        }
        if (isset($incoming['isp'])) {
            $this->isp = self::chooseBetterIsp($this->isp, $incoming['isp']);
        }
        $lat = self::parseCoordinate($incoming['lat'] ?? null);
        $lon = self::parseCoordinate($incoming['lon'] ?? null);
        if ($this->lat === null && $this->lon === null && $lat !== null && $lon !== null) {
            $this->lat = $lat;
            $this->lon = $lon;
        }

        return $this;
    }

    public function hasAtLeastOneIp(): bool
    {
        return !empty($this->ipv4) || !empty($this->ipv6);
    }

    public function shouldStopEarly(): bool
    {
        $hasBothIps = !empty($this->ipv4) && !empty($this->ipv6);
        $hasIsp = self::isMeaningfulText($this->isp);
        $hasCity = self::isMeaningfulText($this->city);
        $hasCountry = self::isMeaningfulText($this->country);
        $hasCoords = $this->lat !== null && $this->lon !== null;

        return $hasBothIps && $hasIsp && $hasCountry && ($hasCity || $hasCoords);
    }
}
