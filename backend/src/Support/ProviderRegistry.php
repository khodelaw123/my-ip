<?php

declare(strict_types=1);

namespace App\Support;

class ProviderRegistry
{
    public const PROVIDER_TIMEOUT_SECONDS = 3.5;
    public const OVERALL_TIMEOUT_SECONDS = 8.0;
    public const CONCURRENCY_LIMIT = 8;

    public const COUNTRY_CODE_MAP = [
        'IR' => 'Iran',
        'US' => 'United States',
        'GB' => 'United Kingdom',
        'DE' => 'Germany',
        'FR' => 'France',
        'TR' => 'Turkey',
        'AE' => 'United Arab Emirates',
        'IQ' => 'Iraq',
        'RU' => 'Russia',
        'NL' => 'Netherlands',
        'CA' => 'Canada',
        'AU' => 'Australia',
        'JP' => 'Japan',
        'CN' => 'China',
        'IN' => 'India',
        'IT' => 'Italy',
        'ES' => 'Spain',
        'SE' => 'Sweden',
        'CH' => 'Switzerland',
        'AT' => 'Austria',
        'BE' => 'Belgium',
        'PL' => 'Poland',
        'FI' => 'Finland',
        'NO' => 'Norway',
        'DK' => 'Denmark',
        'AM' => 'Armenia',
        'AZ' => 'Azerbaijan',
        'GE' => 'Georgia',
        'QA' => 'Qatar',
        'OM' => 'Oman',
        'KW' => 'Kuwait',
        'SA' => 'Saudi Arabia',
    ];

    public const GENERIC_TEXT_VALUES = [
        'unknown',
        'n/a',
        'na',
        'none',
        'null',
        'undefined',
        '-',
        'نامشخص',
    ];

    /**
     * Unblocked base IP reflection providers (supports IPv4 & IPv6).
     * Cloudflare 1.1.1.1 is prioritized for speed and resilience in Iran.
     */
    public static function getBaseIpProviders(): array
    {
        return [
            ['id' => 'cloudflare-1111', 'url' => 'https://1.1.1.1/cdn-cgi/trace', 'format' => 'cloudflare-trace'],
            ['id' => 'cloudflare-trace', 'url' => 'https://www.cloudflare.com/cdn-cgi/trace', 'format' => 'cloudflare-trace'],
            ['id' => 'countryis-ip', 'url' => 'https://api.country.is/', 'format' => 'json'],
            ['id' => 'ipsb-ip', 'url' => 'https://api.ip.sb/ip', 'format' => 'text'],
            ['id' => 'ipify-v4', 'url' => 'https://api4.ipify.org?format=json', 'format' => 'json'],
            ['id' => 'ipify-v6', 'url' => 'https://api6.ipify.org?format=json', 'format' => 'json'],
            ['id' => 'ipify-v64', 'url' => 'https://api64.ipify.org?format=json', 'format' => 'json'],
            ['id' => 'icanhazip-v4', 'url' => 'https://ipv4.icanhazip.com', 'format' => 'text'],
            ['id' => 'icanhazip-v6', 'url' => 'https://ipv6.icanhazip.com', 'format' => 'text'],
            ['id' => 'identme-v4', 'url' => 'https://v4.ident.me', 'format' => 'text'],
            ['id' => 'identme-v6', 'url' => 'https://v6.ident.me', 'format' => 'text'],
            ['id' => 'seeip-json', 'url' => 'https://api.seeip.org/jsonip', 'format' => 'json'],
            ['id' => 'ipquery-ip', 'url' => 'https://api.ipquery.io/', 'format' => 'text'],
        ];
    }

    /**
     * Targeted Geolocation & ISP providers for known client IP.
     * Curated & verified for Iranian operators (Irancell, MCI, Shatel, Asiatech, ArvanCloud).
     */
    public static function getTargetedGeoProviders(string $encodedIp): array
    {
        return [
            [
                'id' => 'ipwhois-geo-targeted',
                'url' => "https://ipwho.is/{$encodedIp}",
                'format' => 'json',
            ],
            [
                'id' => 'ipapi-http-targeted',
                'url' => "http://ip-api.com/json/{$encodedIp}?fields=status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,query",
                'format' => 'json',
            ],
            [
                'id' => 'ipquery-geo-targeted',
                'url' => "https://api.ipquery.io/{$encodedIp}",
                'format' => 'json',
            ],
            [
                'id' => 'ipsb-geo-targeted',
                'url' => "https://api.ip.sb/geoip/{$encodedIp}",
                'format' => 'json',
            ],
            [
                'id' => 'ipwhoisapp-geo-targeted',
                'url' => "https://ipwhois.app/json/{$encodedIp}",
                'format' => 'json',
            ],
            [
                'id' => 'seeip-geo-targeted',
                'url' => "https://api.seeip.org/geoip/{$encodedIp}",
                'format' => 'json',
            ],
            [
                'id' => 'ipapiis-geo-targeted',
                'url' => "https://api.ipapi.is?q={$encodedIp}",
                'format' => 'json',
            ],
            [
                'id' => 'ipinfo-geo-targeted',
                'url' => "https://ipinfo.io/{$encodedIp}/json",
                'format' => 'json',
            ],
        ];
    }

    /**
     * Fallback untargeted providers when client IP is not passed in request headers.
     */
    public static function getUntargetedGeoProviders(): array
    {
        return [
            ['id' => 'ipwhois-geo', 'url' => 'https://ipwho.is/', 'format' => 'json'],
            ['id' => 'ipapi-http-geo', 'url' => 'http://ip-api.com/json/?fields=status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,query', 'format' => 'json'],
            ['id' => 'ipquery-geo', 'url' => 'https://api.ipquery.io/', 'format' => 'json'],
            ['id' => 'ipsb-geo', 'url' => 'https://api.ip.sb/geoip', 'format' => 'json'],
            ['id' => 'ipwhoisapp-geo', 'url' => 'https://ipwhois.app/json/', 'format' => 'json'],
            ['id' => 'seeip-geo', 'url' => 'https://api.seeip.org/geoip', 'format' => 'json'],
            ['id' => 'ipapiis-geo', 'url' => 'https://api.ipapi.is', 'format' => 'json'],
        ];
    }
}
