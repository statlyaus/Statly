# Dependency override policy

The root `package.json` uses npm overrides only where transitive resolution must stay consistent across
local, CI, and production installs. Re-evaluate an override whenever its owning direct dependency is
upgraded.

| Override                                       | Purpose                                                                | Remove when                                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `openai > zod`                                 | Keep the OpenAI SDK on the application Zod major.                      | The SDK resolves the application version without an override and typechecks pass.                      |
| `google-auth-library > jws` and `gtoken > jws` | Keep Google authentication paths on the reviewed JWS major.            | Both parents resolve an equal or newer compatible release and Firebase credential/session checks pass. |
| `jsonwebtoken > jws`                           | Keep JWT signing and verification on the reviewed compatible JWS line. | `jsonwebtoken` resolves an equal or newer compatible release and authentication tests pass.            |

Before changing an override:

1. Update the relevant direct dependency and remove only the candidate override.
2. Run `npm ls` for the parent and overridden packages; reject invalid or duplicate resolution.
3. Run application/test typechecks and focused Firebase/authentication tests.
4. Review `npm audit` output manually. Do not use a forced audit fix that introduces unreviewed major
   upgrades.
5. Build with the Node major declared in `package.json` and the production `Dockerfile`.

Firebase Admin's former `@google-cloud/firestore` and `node-forge` overrides were removed after the
13.10.0 upgrade. Firebase Admin now owns those optional dependency ranges.
