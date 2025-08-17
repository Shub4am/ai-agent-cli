import fs from "fs-extra";
import path from "path";


export async function checkExistingClone(outDir, sourceUrl) {
    try {
        const metadataPath = path.join(outDir, '.clone-metadata.json');
        if (!await fs.pathExists(outDir)) {
            return null;
        }
        if (!await fs.pathExists(metadataPath)) {
            const indexPath = path.join(outDir, 'index.html');
            if (await fs.pathExists(indexPath)) {
                return {
                    path: outDir,
                    clonedAt: "Unknown (legacy clone)",
                    sourceUrl: sourceUrl,
                    statistics: {},
                    isLegacy: true
                };
            }
            return null;
        }
        const metadata = await fs.readJson(metadataPath);
        if (metadata.sourceUrl === sourceUrl) {
            return {
                path: outDir,
                clonedAt: metadata.clonedAt,
                sourceUrl: metadata.sourceUrl,
                statistics: metadata.statistics || {},
                isLegacy: false
            };
        }

        return null;

    } catch (error) {
        console.warn(`⚠️ Error checking existing clone: ${error.message}`);
        return null;
    }
}

export async function saveCloneMetadata(outDir, cloneResult) {
    try {
        const metadataPath = path.join(outDir, '.clone-metadata.json');

        const metadata = {
            sourceUrl: cloneResult.sourceUrl,
            domain: cloneResult.domain,
            clonedAt: cloneResult.clonedAt,
            statistics: cloneResult.statistics || {},
            version: "1.0"
        };

        await fs.ensureDir(outDir);
        await fs.writeJson(metadataPath, metadata, { spaces: 2 });

        console.log(`💾 Clone metadata saved to: ${metadataPath}`);

    } catch (error) {
        console.warn(`⚠️ Failed to save clone metadata: ${error.message}`);
    }
}

export async function listAllClones(baseDir = "./cloned-websites") {
    try {
        if (!await fs.pathExists(baseDir)) {
            return [];
        }

        const directories = await fs.readdir(baseDir);
        const clones = [];

        for (const dir of directories) {
            const dirPath = path.join(baseDir, dir);
            const stat = await fs.stat(dirPath);

            if (stat.isDirectory()) {
                const metadataPath = path.join(dirPath, '.clone-metadata.json');

                if (await fs.pathExists(metadataPath)) {
                    try {
                        const metadata = await fs.readJson(metadataPath);
                        clones.push({
                            directory: dir,
                            path: dirPath,
                            ...metadata
                        });
                    } catch (error) {
                        console.warn(`⚠️ Invalid metadata in ${dir}`);
                    }
                }
            }
        }

        return clones;

    } catch (error) {
        console.warn(`⚠️ Error listing clones: ${error.message}`);
        return [];
    }
}

export function sanitizeDomain(domain) {
    return domain.replace(/[^a-zA-Z0-9.-]/g, '_');
}