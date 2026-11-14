---
$schema: urn:oasis:names:tc:dita:xsd:task.xsd
id: run-the-ui-locally
---

# Run the UI locally

Start the site on your computer, with the engine of your copy of the repository.

## Before you start

- Node.js is installed. No other tool is necessary: not Factorio, not the sidecar and not Cloudflare.
- You have a clone of the repository.

## Procedure

1. Go to the folder of the UI.

   ```bash
   cd clock-generator-ui
   ```

2. Install the packages of the UI.

   ```bash
   npm install
   ```

3. Make the engine.

   ```bash
   npm run build:deps
   ```

   The command installs the packages of `clock-generator` and makes the engine in `clock-generator/dist`.

4. Start the development server of Vite.

   ```bash
   npm run dev
   ```

   Vite shows the address of the site.

5. Open the address in a browser.

## Result

The site operates on your computer. It uses the engine of your clone, not the engine of the site of the users.

To make the files of the site, type `npm run build` in `clock-generator-ui`. The command makes the engine and the site
in `clock-generator-ui/dist`. To do a lint check of the UI, type `npm run lint`.

## Related information

- [Running it locally](../../README.md#running-it-locally) in the README
