# Publishing DevContext to npm

This document outlines the steps to publish the DevContext package to the npm registry.

## Prerequisites

Before publishing, ensure you have:

1. An npm account (create one at [npmjs.com](https://www.npmjs.com/signup))
2. Logged in to npm on your local machine
3. Proper access rights to publish under the chosen package name

## Steps to Publish

### 1. Prepare Your Environment

```bash
# Login to npm (if not already logged in)
npm login

# Verify you're logged in
npm whoami
```

### 2. Review Package Content

Make sure the package content is correct:

```bash
# Perform a dry run to see what will be published
npm publish --dry-run
```

Review the files that will be included in the published package and make sure no sensitive or unnecessary files are included.

### 3. Versioning

Before publishing, ensure the package version is correctly set in `package.json`. Use semantic versioning:

- **Major version**: Breaking changes
- **Minor version**: New features (backward compatible)
- **Patch version**: Bug fixes (backward compatible)

To update the version:

```bash
# Update version directly
npm version patch   # For bug fixes
npm version minor   # For new features
npm version major   # For breaking changes
```

### 4. Publish to npm Registry

```bash
# Publish the package
npm publish
```

### 5. Verify the Published Package

After publishing, verify that your package is correctly published:

```bash
# View package info
npm view devcontext

# Install your package globally to test it
npm install -g devcontext

# Run your package
devcontext
```

## Updating the Package

To publish updates to an existing package:

1. Make your changes
2. Run tests
3. Update the version (`npm version patch|minor|major`)
4. Run `npm publish`

## Special Considerations for DevContext

- Remember that DevContext requires a TursoDB database, so make sure this requirement is clearly documented
- Consider adding unit tests before the 1.0.0 release
- Maintain clear documentation for the core MCP tools

## Troubleshooting

If you encounter issues during publishing:

- **Name conflicts**: If the package name is already taken, you might need to scope it with your username (`@username/devcontext`)
- **Permission errors**: Ensure you have the right npm account and proper permissions
- **Failed validation**: Review the error messages and fix any package.json issues

## Support

If users have issues with the package, ensure they can reach out through:

- GitHub issues
- Documentation
- README contact information
