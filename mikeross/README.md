# Boltable Node.js + TypeScript App Starter

This template helps you publish a simple backend API on Boltable using Node.js, TypeScript, and Express.

## How to update your app (GitHub web UI)

1. Open your repository in GitHub.
2. Click `Add file` (top-right), then select `Upload files`.
3. Drag and drop your updated files (or choose them from your computer).
4. In the commit section, select `Commit directly to the main branch`.
5. Click `Commit changes`.
6. Wait for the deployment pipeline to finish.

## Where your app will be available

After deployment finishes, your app should be available at:

- `https://<repo-name>.boltable.eu`

The starter includes this endpoint:

| Endpoint | Description |
|---|---|
| `/api/hello` | Returns a greeting with the current time |

## Test locally before uploading

1. Make sure you have [Node.js](https://nodejs.org/) installed.
2. Run from the repository root:
   - `npm install`
   - `npm run build`
   - `npm start`
3. Then open: `http://localhost:8080/api/hello`

## Notes

- If deployment does not update after a few minutes, contact the Boltable support Slack channel, [#boltable-support](https://bolt.enterprise.slack.com/archives/C0AFQCGN62F).
