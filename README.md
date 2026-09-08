# grappy

Electron hello world app.

## Development

Install dependencies:

```sh
npm install
```

If this warning shows: _"The SUID sandbox helper binary was found, but is not configured correctly. Rather than run without sandboxing I'm aborting now."_ run:

```sh
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

Run the app:

```sh
npm start
```

Lint and format:

```sh
npm run lint
npm run format
```
