import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VPNGATE_MIRRORS = [
    'https://www.vpngate.net/api/iphone/',
    'http://www.vpngate.net/api/iphone/'
];

/**
 * Fetch VPNGate server list from the official SoftEther VPNGate API
 */
export async function fetchVpnGateServers(timeoutMs = 15000) {
    let lastError = null;

    for (const url of VPNGATE_MIRRORS) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);

            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            clearTimeout(timeout);

            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
            }

            const rawData = await response.text();
            const servers = parseVpnGateCsv(rawData);
            if (servers.length > 0) {
                return servers;
            }
        } catch (err) {
            lastError = err;
        }
    }

    throw lastError || new Error('Failed to fetch from VPNGate mirrors');
}

/**
 * Parse VPNGate CSV output
 */
function parseVpnGateCsv(csvText) {
    const lines = csvText.split(/\r?\n/);
    const servers = [];

    for (const line of lines) {
        if (!line || line.startsWith('*') || line.startsWith('#')) {
            continue;
        }

        const parts = line.split(',');
        if (parts.length < 15) continue;

        const [
            hostName,
            ip,
            score,
            ping,
            speed,
            countryLong,
            countryShort,
            numVpnSessions,
            uptime,
            totalUsers,
            totalTraffic,
            logType,
            operator,
            message,
            openVpnConfigBase64
        ] = parts;

        if (!openVpnConfigBase64) continue;

        servers.push({
            hostName,
            ip,
            score: parseInt(score, 10) || 0,
            ping: parseInt(ping, 10) || 999,
            speed: parseInt(speed, 10) || 0, // bps
            speedMbps: ((parseInt(speed, 10) || 0) / (1024 * 1024)).toFixed(2),
            countryLong: countryLong || 'Unknown',
            countryShort: (countryShort || 'XX').toUpperCase(),
            numVpnSessions: parseInt(numVpnSessions, 10) || 0,
            uptime: parseInt(uptime, 10) || 0,
            configBase64: openVpnConfigBase64
        });
    }

    return servers;
}

/**
 * Filter and get top VPNGate servers by country and speed
 */
export function getTopServers(servers, { country = null, limit = 5 } = {}) {
    let filtered = servers;
    if (country) {
        filtered = filtered.filter(s => s.countryShort === country.toUpperCase());
    }

    // Sort by score and speed descending, and lowest ping
    return filtered
        .sort((a, b) => b.score - a.score || b.speed - a.speed || a.ping - b.ping)
        .slice(0, limit);
}

/**
 * Export OpenVPN profile to a file
 */
export function exportOpenVpnConfig(server, outputPath) {
    const decodedConfig = Buffer.from(server.configBase64, 'base64').toString('utf8');
    const resolvedPath = path.resolve(outputPath);
    fs.writeFileSync(resolvedPath, decodedConfig, 'utf8');
    return resolvedPath;
}

// CLI Execution handler
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    (async () => {
        const countryArgIndex = process.argv.indexOf('--country');
        const country = countryArgIndex !== -1 ? process.argv[countryArgIndex + 1] : null;

        const exportIndex = process.argv.indexOf('--export');
        const outputPath = exportIndex !== -1 ? (process.argv[exportIndex + 1] || 'vpngate.ovpn') : null;

        console.log(`🌐 Fetching SoftEther VPNGate public relay nodes...`);
        try {
            const servers = await fetchVpnGateServers();
            console.log(`✅ Loaded ${servers.length} active VPNGate servers.`);

            const topServers = getTopServers(servers, { country, limit: 5 });

            if (topServers.length === 0) {
                console.log(`⚠️ No servers found matching criteria (Country: ${country || 'Any'}).`);
                return;
            }

            console.log(`\n🏆 Top Servers ${country ? `for ${country}` : '(Global)'}:`);
            topServers.forEach((s, idx) => {
                console.log(`  [${idx + 1}] IP: ${s.ip} | Country: ${s.countryShort} (${s.countryLong}) | Speed: ${s.speedMbps} Mbps | Ping: ${s.ping}ms | Sessions: ${s.numVpnSessions}`);
            });

            if (outputPath) {
                const bestServer = topServers[0];
                const exportedFile = exportOpenVpnConfig(bestServer, outputPath);
                console.log(`\n💾 Exported OpenVPN config for best node (${bestServer.ip}, ${bestServer.countryShort}) to: ${exportedFile}`);
            }
        } catch (err) {
            console.error(`❌ Failed to fetch VPNGate servers:`, err.message);
        }
    })();
}
