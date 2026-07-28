# Dependency Override Policy

The root `package.json` uses npm overrides only where transitive dependency resolution must stay consistent across local, CI, and production installs. An override is not permanent by default; review it whenever the owning direct dependency is upgraded.

| Override                                       | Purpose                                                                                              | Remove when                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `openai > zod`                                 | Keep the OpenAI SDK on the same Zod major used by the application.                                   | The SDK's declared Zod range resolves to the application version without an override and typechecks pass.  |
| `google-auth-library > jws` and `gtoken > jws` | Keep Google authentication paths on the reviewed JWS major.                                          | Both parents resolve an equal or newer compatible JWS release and Firebase credential/session checks pass. |
| `jsonwebtoken > jws`                           | Keep JSON Web Token signing and verification on the reviewed compatible JWS line.                    | `jsonwebtoken` resolves an equal or newer compatible release and authentication tests pass.                |

Before removing or changing an override:

1. Update the relevant direct dependency and remove only the candidate override.
2. Run `npm ls` for the parent and overridden packages; reject invalid or duplicate resolution.
3. Run application and test typechecks plus focused Firebase/authentication tests.
4. Review `npm audit` output manually. Do not use a forced audit fix that introduces unreviewed major upgrades.
5. Build with the Node major declared in `package.json` and the production `Dockerfile`.

The Firebase Admin `@google-cloud/firestore` and `node-forge` overrides were
removed after the 13.10.0 upgrade. Firebase Admin now owns those optional
dependency ranges, so the application no longer pins their transitive versions
independently.
