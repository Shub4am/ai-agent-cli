import "dotenv/config";
import readline from "readline";
import { OpenAI } from "openai";
import { exec } from "child_process";
import { checkExistingClone, saveCloneMetadata, sanitizeDomain } from './cloneManager.js';

const inputInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function getUserInput(prompt) {
    return new Promise((resolve) => inputInterface.question(prompt, resolve));
}

async function getMirrorWebsite(targetUrl) {
    let validatedUrl;
    try {
        validatedUrl = new URL(targetUrl);
        if (!['http:', 'https:'].includes(validatedUrl.protocol)) {
            throw new Error('Only HTTP and HTTPS URLs are supported');
        }
    } catch (error) {
        throw new Error(`Invalid URL provided: ${error.message}`);
    }

    const domain = validatedUrl.hostname.replace('www.', '');
    const sanitizedDomain = sanitizeDomain(domain);
    const baseOutDir = `./cloned-websites/${sanitizedDomain}`;
    const existingClone = await checkExistingClone(baseOutDir, validatedUrl.href);

    if (existingClone) {
        console.log(`🎯 Website already cloned at: ${existingClone.path}`);
        console.log(`📅 Cloned on: ${existingClone.clonedAt}`);
        console.log(`🔄 Skipping re-clone (use force option to override)`);
        return {
            success: true,
            message: "✅ Website already exists locally",
            outputPath: existingClone.path,
            sourceUrl: validatedUrl.href,
            clonedAt: existingClone.clonedAt,
            isExisting: true,
        };
    }
    console.log(`🌐 Initializing website mirror for: ${validatedUrl.href}`);

    let cloneModule;
    try {
        cloneModule = await import("./cloneWebsite.js");
    } catch (importError) {
        throw new Error(`Failed to load cloning module: ${importError.message}`);
    }

    const cloneConfig = {
        outDir: baseOutDir,
        mirrorExternalAssets: true,
        maxPages: 10,
        concurrency: 8
    };

    console.log(`📁 Output directory: ${cloneConfig.outDir}`);
    console.log(`📊 Max pages limit: ${cloneConfig.maxPages}`);

    try {
        const result = await cloneModule.cloneWebsite(validatedUrl.href, cloneConfig);
        result.clonedAt = new Date().toISOString();
        result.sourceUrl = validatedUrl.href;
        result.domain = domain;
        result.isExisting = false;
        await saveCloneMetadata(baseOutDir, result);
        console.log(`✅ Website mirroring completed successfully!`);
        return result;
    } catch (cloneError) {
        console.error(`❌ Cloning failed: ${cloneError.message}`);
        throw new Error(`Website cloning failed: ${cloneError.message}`);
    }
}

async function runSystemCommand(cmd = '') {
    return new Promise((res, rej) => {
        exec(cmd, (error, data) => {
            if (error) rej(error.message);
            else res(data);
        });
    });
}

const AVAILABLE_TOOLS = {
    runSystemCommand,
    getMirrorWebsite,
};

const client = new OpenAI();

async function startAgent() {
    const websiteUrl = await getUserInput("🌐 Enter the website URL to clone: ");
    inputInterface.close();

    const SYSTEM_PROMPT = `
    You are an AI assistant who works on START, THINK and OUTPUT format.
    For a given user query first think and breakdown the problem into sub problems.
    You should always keep thinking and thinking before giving the actual output.
    
    Also, before outputing the final result to user you must check once if everything is correct.
    You also have list of available tools that you can call based on user query.
    
    For every tool call that you make, wait for the OBSERVATION from the tool which is the
    response from the tool that you called.

    Available Tools:
    - runSystemCommand(command: string): Takes a linux / unix command as arg and executes the command on user's machine and returns the output
    - getMirrorWebsite(targetUrl: string): Clones the website of the given URL into a dynamically functional offline version.

    CRITICAL RULES:
    - Return ONLY ONE JSON object per response, never multiple JSON objects
    - Strictly follow the output JSON format
    - Always follow the output in sequence that is START, THINK, OBSERVE and OUTPUT.
    - Always perform only one step at a time and wait for other step.
    - Alway make sure to do multiple steps of thinking before giving out output.
    - For every tool call always wait for the OBSERVE which contains the output from tool
    - Your entire response must be a single valid JSON object, nothing else

    Output JSON Format (ONLY ONE PER RESPONSE):
    { "step": "START | THINK | OUTPUT | OBSERVE | TOOL" , "content": "string", "tool_name": "string", "input": "string" }

    Example:
    User: Hey, i want to clone the given website "https://www.piyushgarg.dev". Can you clone the entire website locally using plain HTML/CSS/JS ?
    ASSISTANT: { "step": "START", "content": "The user wants to clone the entire website 'https://www.piyushgarg.dev' locally" }
    ASSISTANT: { "step": "THINK", "content": "Check if the website is available online, if yes continue, if not return an error message" }
    ASSISTANT: { "step": "THINK", "content": "Rewrite all external and third-party links and code so that the site runs completely offline without dependencies on external APIs." }
    ASSISTANT: { "step": "THINK", "content": "The task is to clone the website into a completely functional offline version using plain HTML/CSS/JS with responsive layout, completely matching the original design, and organize the assets in a clean directory structure (/html, /assets, etc.)."}
    ASSISTANT: { "step": "THINK", "content": "Let me check if there are any available tools for this query" }
    ASSISTANT: { "step": "THINK", "content": "I see that there is a tool available getMirrorWebsite which can be used to clone the website" }
    ASSISTANT: { "step": "THINK", "content": "I need to call getMirrorWebsite for url https://www.piyushgarg.dev to clone the website" }
    ASSISTANT: { "step": "THINK", "content": "I need to check if i have already cloned this website previously." }
    ASSISTANT: { "step": "TOOL", "input": "https://www.piyushgarg.dev", "tool_name": "getMirrorWebsite" }
    DEVELOPER: { "step": "OBSERVE", "content": "The website 'https://www.piyushgarg.dev' has been cloned successfully, with a limited number of pages to avoid overloading the server." }
    ASSISTANT: { "step": "OUTPUT", "content": "The website 'https://www.piyushgarg.dev' has been cloned successfully and is available locally." }
  `;

    const conversationHistory = [
        {
            role: "system",
            content: SYSTEM_PROMPT,
        },
        {
            role: "user",
            content: `Create a complete offline mirror of ${websiteUrl}. Convert all external dependencies 
       to work locally.`,
        },
    ];

    while (true) {
        const aiResponse = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: conversationHistory,
        });

        const responseText = aiResponse.choices[0].message.content.trim();
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(responseText);
        } catch (error) {
            try {
                const jsonLine = responseText
                    .split('\n')
                    .map(line => line.trim())
                    .find(line => line.startsWith('{') && line.endsWith('}'));

                if (!jsonLine) {
                    throw new Error('No valid JSON object found in response');
                }

                parsedResponse = JSON.parse(jsonLine);
            } catch (secondError) {
                console.error("Failed to parse AI response:", responseText);
                console.error("Parse error:", error.message);
                console.error("Fallback parse error:", secondError.message);
            }
        }

        conversationHistory.push({
            role: "assistant",
            content: JSON.stringify(parsedResponse),
        });

        if (parsedResponse.step === "START") {
            console.log(`🤖`, parsedResponse.content);
            continue;
        }

        if (parsedResponse.step === "THINK") {
            console.log(`🧠`, parsedResponse.content);
            continue;
        }

        try {
            if (parsedResponse.step === "TOOL") {
                const selectedTool = parsedResponse.tool_name;
                if (!AVAILABLE_TOOLS[selectedTool]) {
                    console.error(`❌ Tool '${selectedTool}' not found. Available tools:`, Object.keys(AVAILABLE_TOOLS));
                    conversationHistory.push({
                        role: "developer",
                        content: JSON.stringify({
                            step: "OBSERVE",
                            content: `Tool '${selectedTool}' is not available. Available tools: ${Object.keys(AVAILABLE_TOOLS).join(', ')}`
                        }),
                    });
                    continue;
                }

                console.log(`🛠️ Executing ${selectedTool} with input: ${parsedResponse.input}`);
                const toolResult = await AVAILABLE_TOOLS[selectedTool](parsedResponse.input);
                console.log(`✅ ${selectedTool} completed successfully`);

                conversationHistory.push({
                    role: "developer",
                    content: JSON.stringify({ step: "OBSERVE", content: toolResult }),
                });

                continue;
            }
        } catch (err) {
            console.error(
                `⚠️ Tool execution failed for ${parsedResponse.input}:`,
                err
            );
            conversationHistory.push({
                role: "developer",
                content: JSON.stringify({
                    step: "OBSERVE",
                    content: err?.message || String(err),
                }),
            });
        }

        if (parsedResponse.step === "OUTPUT") {
            console.log(`✔️`, parsedResponse.content);
            break;
        }
    }
    console.log("\n✅ Process completed successfully!");
}

startAgent();