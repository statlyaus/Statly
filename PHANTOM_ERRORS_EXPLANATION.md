These VS Code workspace settings must live in `.vscode/settings.json` to take effect. If placed directly in a Markdown file, VS Code will ignore them. Create the file `.vscode/settings.json` and use the following content:

```json
{
  "typescript.tsserver.maxTsServerMemory": 4096,
  "typescript.tsserver.useSeparateSyntaxServer": true,
  "files.watcherExclude": {
    "**/node_modules/**": true,
    "**/.next/**": true,
    "**/dist/**": true,
    "**/.turbo/**": true,
    "**/.vercel/**": true,
    "**/coverage/**": true
  },
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "eslint.validate": ["javascript", "typescript", "typescriptreact"]
}
```
