import * as cheerio from "cheerio";
import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import pLimit from "p-limit";

const parseRobotsForUserAgent = (robotsText, userAgent) => {
    const lines = robotsText.split('\n').map(line => line.trim());
    let currentUserAgent = null;
    let disallowedPaths = [];
    let crawlDelay = 0;

    for (const line of lines) {
        if (line.startsWith('User-agent:')) {
            const agent = line.split(':')[1].trim();
            currentUserAgent = (agent === '*' || agent === userAgent) ? agent : null;
        } else if (currentUserAgent && line.startsWith('Disallow:')) {
            const path = line.split(':')[1].trim();
            if (path) disallowedPaths.push(path);
        } else if (currentUserAgent && line.startsWith('Crawl-delay:')) {
            crawlDelay = parseInt(line.split(':')[1].trim()) || 0;
        }
    }
    return { disallowedPaths, crawlDelay };
};

const parseRobots = async (baseUrl) => {
    try {
        const robotsUrl = new URL('/robots.txt', baseUrl);
        const response = await fetch(robotsUrl, {
            signal: AbortSignal.timeout(10000),
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; WebsiteCloner/1.0)'
            }
        });

        if (!response.ok) return { disallowedPaths: [], crawlDelay: 0 };

        const robotsText = await response.text();
        return parseRobotsForUserAgent(robotsText, 'WebsiteCloner');
    } catch {
        return { disallowedPaths: [], crawlDelay: 0 };
    }
};

const isUrlAllowed = (url, disallowedPaths) => {
    const pathname = new URL(url).pathname;
    return !disallowedPaths.some(path => {
        if (path.endsWith('*')) {
            return pathname.startsWith(path.slice(0, -1));
        }
        return pathname === path || pathname.startsWith(path + '/');
    });
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function cloneWebsite(targetUrl, options = {}) {
    const {
        outDir = "cloned-websites",
        maxPages = 10,
        mirrorExternalAssets = true,
        concurrency = 10,
        respectRobots = true
    } = options;

    const root = new URL(targetUrl);
    const rootOrigin = root.origin;
    const outputDir = path.join(process.cwd(), outDir);
    const limit = pLimit(concurrency);
    let robotsRules = { disallowedPaths: [], crawlDelay: 0 };
    if (respectRobots) {
        console.log(`🤖 Checking robots.txt for ${rootOrigin}...`);
        robotsRules = await parseRobots(root);
        if (robotsRules.disallowedPaths.length > 0) {
            console.log(`📋 Found ${robotsRules.disallowedPaths.length} disallowed paths in robots.txt`);
        }
        if (robotsRules.crawlDelay > 0) {
            console.log(`⏰ Crawl delay: ${robotsRules.crawlDelay} seconds`);
        }
    }
    const localizeAssetPath = (url) => {
        const urlPath = url.pathname.split("/").filter(Boolean).join("_");
        const base = path.basename(urlPath || "asset");
        const hash = crypto
            .createHash("md5")
            .update(url.href)
            .digest("hex")
            .slice(0, 6);
        return `assets/${hash}-${base}`;
    };

    const mapTargetUrlToFilePath = (url) => {
        let pathname = url.pathname;
        if (pathname.endsWith("/")) {
            pathname += "index.html";
        } else if (!path.extname(pathname)) {
            pathname += "/index.html";
        }
        return path.join(outputDir, pathname.replace(/^\/+/, ""));
    };

    const SKIPPABLE_HREF_PREFIXES = ["#", "mailto:", "tel:", "javascript:"];
    const isSkippableHref = (href) =>
        !href || SKIPPABLE_HREF_PREFIXES.some(prefix => href.startsWith(prefix));

    const visitedPages = new Set();
    const pageQueue = [root.href];
    const assetSet = new Set();
    await fs.emptyDir(outputDir);
    console.log(`🚀 Starting website clone: ${targetUrl}`);
    console.log(`📁 Output directory: ${outputDir}`);

    while (pageQueue.length && visitedPages.size < maxPages) {
        const currentUrl = pageQueue.shift();
        if (visitedPages.has(currentUrl)) continue;
        if (respectRobots && !isUrlAllowed(currentUrl, robotsRules.disallowedPaths)) {
            console.log(`🚫 Skipping disallowed URL: ${currentUrl}`);
            continue;
        }
        visitedPages.add(currentUrl);
        console.log(`📄 Processing url ${visitedPages.size}/${maxPages}: ${currentUrl}`);
        if (respectRobots && robotsRules.crawlDelay > 0 && visitedPages.size > 1) {
            console.log(`⏳ Waiting ${robotsRules.crawlDelay}s (crawl delay)...`);
            await sleep(robotsRules.crawlDelay * 1000);
        }
        let response;
        try {
            response = await fetch(currentUrl, {
                signal: AbortSignal.timeout(20000),
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; WebsiteCloner/1.0)'
                }
            });
        } catch (error) {
            console.warn(`Error fetching the url ${currentUrl}:`, error.message);
            continue;
        }
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("text/html")) {
            console.warn(`⚠️ Skipping non-HTML page ${currentUrl} (${contentType})`);
            continue;
        }
        const html = await response.text();
        const $ = cheerio.load(html);
        $("img").each((_, element) => {
            const $img = $(element);
            ["src", "data-src"].forEach((attr) => {
                const value = $img.attr(attr);
                if (!value) return;
                if (value.includes("/_next/image") && value.includes("url=")) {
                    try {
                        const decodeURL = decodeURIComponent(
                            value.split("url=")[1].split("&")[0]
                        );
                        const absoluteUrl = new URL(decodeURL, currentUrl);
                        const localPath = localizeAssetPath(absoluteUrl);
                        $img.attr("src", localPath);
                        assetSet.add(absoluteUrl.href);
                    } catch {
                        console.warn(`⚠️ Failed to decode next/image: ${value}`);
                    }
                } else if (!value.startsWith("data:")) {
                    const absoluteUrl = new URL(value, currentUrl);
                    $img.attr("src", localizeAssetPath(absoluteUrl));
                    assetSet.add(absoluteUrl.href);
                }
            });
            const srcset = $img.attr("srcset");
            if (srcset) {
                const parts = srcset.split(",").map((entry) => {
                    const [url, descriptor] = entry.trim().split(/\s+/);
                    if (!url) return entry;

                    let fixedUrl = url;
                    if (url.includes("/_next/image?url=")) {
                        const match = url.match(/\/_next\/image\?url=([^&]+)/);
                        if (match?.[1]) {
                            fixedUrl = decodeURIComponent(match[1]);
                        }
                    }
                    const absoluteUrl = new URL(fixedUrl, currentUrl);
                    assetSet.add(absoluteUrl.href);
                    return `${localizeAssetPath(absoluteUrl)}${descriptor ? " " + descriptor : ""}`;
                });
                $img.attr("srcset", parts.join(", "));
            }
            $img.removeAttr("data-src data-nimg decoding loading");
        });
        $("link[href]").each((_, element) => {
            const $link = $(element);
            const href = $link.attr("href");
            if (!href || href.startsWith("data:")) return;

            const absoluteUrl = new URL(href, currentUrl);
            $link.attr("href", localizeAssetPath(absoluteUrl));
            assetSet.add(absoluteUrl.href);
        });
        $("script[src]").each((_, element) => {
            const $script = $(element);
            const src = $script.attr("src");
            if (!src || src.startsWith("data:")) return;

            const absoluteUrl = new URL(src, currentUrl);
            $script.attr("src", localizeAssetPath(absoluteUrl));
            assetSet.add(absoluteUrl.href);
        });
        $("a[href]").each((_, element) => {
            const $link = $(element);
            const href = $link.attr("href");
            if (isSkippableHref(href)) return;

            const absoluteUrl = new URL(href, currentUrl);
            if (absoluteUrl.origin === rootOrigin) {
                absoluteUrl.search = "";
                absoluteUrl.hash = "";

                let prettyPath = absoluteUrl.pathname;
                if (!path.extname(prettyPath) && !prettyPath.endsWith("/")) {
                    prettyPath += "/";
                }
                $link.attr("href", prettyPath);
                const shouldAdd = !visitedPages.has(absoluteUrl.href) &&
                    !pageQueue.includes(absoluteUrl.href) &&
                    (!respectRobots || isUrlAllowed(absoluteUrl.href, robotsRules.disallowedPaths));

                if (shouldAdd) {
                    pageQueue.push(absoluteUrl.href);
                }
            }
        });
        const filePath = mapTargetUrlToFilePath(new URL(currentUrl));
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, $.html(), "utf8");
        console.log(`✅ Saved page: ${filePath}`);
    }
    console.log(`📦 Downloading ${assetSet.size} assets...`);
    await Promise.all(
        [...assetSet].map((assetUrl) =>
            limit(async () => {
                try {
                    const url = new URL(assetUrl);
                    if (url.protocol !== "http:" && url.protocol !== "https:") {
                        return;
                    }
                    if (url.origin !== rootOrigin && !mirrorExternalAssets) {
                        return;
                    }
                    const response = await fetch(assetUrl, {
                        signal: AbortSignal.timeout(15000),
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (compatible; WebsiteCloner/1.0)'
                        }
                    });
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    const buffer = Buffer.from(await response.arrayBuffer());
                    const localPath = localizeAssetPath(url);
                    const filePath = path.join(outputDir, localPath);

                    await fs.ensureDir(path.dirname(filePath));
                    await fs.writeFile(filePath, buffer);
                    console.log(`✅ Downloaded asset: ${localPath}`);
                } catch (error) {
                    console.warn(`❌ Failed to download asset ${assetUrl}:`, error.message);
                }
            })
        )
    );

    const result = {
        success: true,
        message: "✅ Website cloned successfully",
        outputPath: outputDir,
        statistics: {
            pagesCloned: visitedPages.size,
            assetsDownloaded: assetSet.size,
            maxPagesReached: visitedPages.size >= maxPages,
            robotsRespected: respectRobots
        }
    };

    console.log(`🎉 Clone complete! 📁 Output: ${result.outputPath}`);
    return result;
}