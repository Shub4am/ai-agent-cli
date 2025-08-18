# Chaicode AI Agent CLI

Chaicode AI Agent CLI is a command-line tool designed to clone websites locally and make them functional for offline use. It leverages AI and modern web scraping techniques to download, parse, and reconstruct websites, enabling developers and researchers to analyze or interact with web content without requiring an internet connection.

## Features

- **Website Cloning:** Download entire websites or specific pages, including HTML, CSS, JavaScript, images, and assets.
- **Offline Functionality:** Rewrites resource links and scripts to ensure the cloned site works seamlessly offline.
- **AI-Powered Parsing:** Utilizes AI (OpenAI API) and advanced parsing libraries to handle dynamic content and complex web structures.
- **Parallel Downloads:** Efficiently fetches multiple resources in parallel for faster cloning.
- **Customizable:** Easily extend or modify the tool for specialized use cases.

## How It Works

1. **Input:** Provide a URL to clone.
2. **Fetching:** The tool downloads the HTML and all linked resources (HTML, CSS, JS, images, etc.).
3. **Parsing:** Uses Cheerio and DomHandler to parse and manipulate the DOM.
4. **Rewriting:** Updates resource paths to point to local files, ensuring offline compatibility.
5. **Saving:** Stores the cloned content in a structured directory, mirroring the original website.
6. **Optimized:** Checks for already cloned website.

## Installation

1. **Clone the repository:**
   ```sh
   git clone https://github.com/Shub4am/ai-agent-cli.git
   cd ai-agent-cli
   ```
2. **Install dependencies:**
   ```sh
   npm install
   ```
3. **Add Environment Variables:** 
   Create a `.env` file in the project root to store sensitive information, such as your OpenAI API key:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   ```

## Usage

Run the CLI directly:

```sh
ai-agent-cli
```

Or with Node.js:

```sh
npm run start
```

You can configure the tool or specify target URLs by editing the source files or extending the CLI interface.

## Project Structure

- `src/`
  - `index.js` — Entry point for the CLI.
  - `cloneWebsite.js` — Handles the logic for downloading and parsing websites.
  - `cloneManager.js` — Manages multiple cloning tasks and coordinates resource handling.
- `cloned-websites/` — Output directory for cloned sites, organized by domain.
- `package.json` — Project metadata and dependencies.

## CLI Screenshot

<img width="1476" height="436" alt="Image" src="https://github.com/user-attachments/assets/20aa3427-88ea-4c89-bc0b-bdce7258ce60" />

## Video demo:

[Youtube video link ](https://www.youtube.com/watch?v=u6fwx_ledX0)


## Disclaimer

This tool is intended **strictly for educational and research purposes**. Do not use it to infringe on copyrights or violate website terms of service. Always respect intellectual property rights when cloning web content.

## License

This project is licensed under the MIT License.
