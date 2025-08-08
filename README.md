# Deployment SFTP

A secure Visual Studio Code and Cursor extension for managing SFTP deployment profiles with SSH key authentication, file operations, and automatic deployment capabilities.

## Features

### 🔐 **Secure Authentication**
- **SSH Key Authentication**: Use your system's SSH agent or custom private keys
- **Password Authentication**: Secure password storage using VS Code's SecretStorage
- **Passphrase Support**: Encrypted private key support with secure passphrase storage
- **No Credential Sharing**: Credentials are stored securely and not shared between extensions

### 📁 **File Operations**
- **Upload Files**: Deploy individual files to remote servers
- **Download Files**: Download remote files to your local machine
- **Delete Files**: Remove files from remote servers with confirmation
- **Diff Files**: Compare local files with their remote versions
- **Auto-Deploy**: Automatically deploy files on save (configurable per profile)

### 🛠 **Profile Management**
- **Multiple Profiles**: Manage multiple SFTP deployment profiles
- **Profile Switching**: Quick switching between profiles via status bar
- **Web-based Management**: Intuitive web interface for profile management
- **Secure Storage**: Profile configurations stored in `.vscode/deployments.sftp.json`

### 🎯 **Cursor Compatibility**
- Fully compatible with Cursor IDE
- Same functionality and security features as VS Code
- Seamless integration with Cursor's interface

## Requirements

- **SSH Keys**: Configure SSH keys in your system's `~/.ssh` directory
- **SSH Agent**: Load your keys in the SSH agent for automatic authentication
- **VS Code/Cursor**: Version 1.102.0 or higher

## Installation

1. Install the extension from the VS Code/Cursor marketplace
2. Configure your SSH keys (see [SSH Setup](#ssh-setup) below)
3. Create your first SFTP profile

## SSH Setup

### Using SSH Agent (Recommended)

1. **Generate SSH Key** (if you don't have one):
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   ```

2. **Add Key to SSH Agent**:
   ```bash
   ssh-add ~/.ssh/id_ed25519
   ```

3. **Add Public Key to Server**:
   ```bash
   ssh-copy-id username@your-server.com
   ```

### Using Custom Private Key

1. **Select Private Key**: When creating a profile, choose "Custom Private Key"
2. **Browse to Key File**: Select your private key file (e.g., `~/.ssh/id_rsa`)
3. **Enter Passphrase**: If your key is encrypted, provide the passphrase

## Usage

### Quick Start

1. **Add Profile**: Use Command Palette → "Add SFTP Deployment Profile"
2. **Configure Connection**: Enter host, port, username, and remote path
3. **Choose Auth Method**: Select SSH key or password authentication
4. **Deploy Files**: Right-click files in explorer → "SFTP: Deploy This File"

### Commands

#### Profile Management
- `Add SFTP Deployment Profile`: Create a new deployment profile
- `Edit SFTP Deployment Profile`: Modify existing profile settings
- `Remove SFTP Deployment Profile`: Delete a profile and its credentials
- `Switch SFTP Deployment Profile`: Change the active profile
- `Manage SFTP Deployment Profiles`: Open web interface for profile management

#### File Operations
- `SFTP: Deploy This File`: Upload the selected file to remote server
- `SFTP: Download File`: Download remote file to local machine
- `SFTP: Delete File`: Remove file from remote server
- `SFTP: Diff With Remote`: Compare local file with remote version

### Status Bar

The status bar shows the current active profile. Click it to switch between profiles.

### Context Menu

Right-click on files in the explorer to access SFTP operations:
- Deploy This File
- Download File
- Delete File
- Diff With Remote

## Configuration

### Profile Structure

Profiles are stored in `.vscode/deployments.sftp.json`:

```json
{
  "deployments": [
    {
      "name": "Production Server",
      "host": "example.com",
      "port": 22,
      "username": "deploy",
      "remotePath": "/var/www/html",
      "authMethod": "ssh-key",
      "privateKeyPath": "/path/to/private/key",
      "deployOnSave": true
    }
  ]
}
```

### Profile Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Profile display name |
| `host` | string | Remote server hostname/IP |
| `port` | number | SSH port (default: 22) |
| `username` | string | SSH username |
| `remotePath` | string | Remote directory path |
| `authMethod` | string | `ssh-key` or `password` |
| `privateKeyPath` | string | Path to private key file (optional) |
| `deployOnSave` | boolean | Auto-deploy on file save |

### Security Features

- **SecretStorage**: Passwords and passphrases stored securely in VS Code's SecretStorage
- **No Plain Text**: No credentials stored in configuration files
- **Extension Isolation**: Credentials not shared between extensions
- **SSH Agent Integration**: Leverages system SSH agent for key management

## Auto-Deploy

Enable auto-deploy for specific profiles to automatically upload files when you save them:

1. **Edit Profile**: Use "Edit SFTP Deployment Profile"
2. **Enable Auto-Deploy**: Select "Yes" for "Deploy on save?"
3. **Save Changes**: The profile will now auto-deploy files on save

## Troubleshooting

### Connection Issues

1. **Check SSH Keys**: Ensure your SSH keys are properly configured
2. **Verify SSH Agent**: Run `ssh-add -l` to see loaded keys
3. **Test Connection**: Try `ssh username@host` from terminal
4. **Check Permissions**: Ensure private key has correct permissions (600)

### Authentication Errors

1. **Password Authentication**: Ensure password is correctly stored
2. **SSH Key Issues**: Verify private key path and passphrase
3. **Server Configuration**: Check server's SSH configuration

### File Operation Errors

1. **Permissions**: Ensure user has write permissions on remote path
2. **Path Issues**: Verify remote path exists and is accessible
3. **Network**: Check network connectivity to server

## Development

### Building from Source

1. **Clone Repository**:
   ```bash
   git clone https://github.com/markoscapin/deployment-sftp.git
   cd deployment-sftp
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Compile TypeScript**:
   ```bash
   npm run compile
   ```

4. **Run in Development**:
   - Press `F5` in VS Code/Cursor
   - Extension will run in a new Extension Development Host window

### Testing

```bash
npm test
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Release Notes

### 0.0.3
- Enhanced SSH key authentication support
- Added download and delete file operations
- Improved security with SecretStorage
- Better profile management interface
- Cursor IDE compatibility
- Auto-deploy functionality
- Comprehensive error handling

### 0.0.2
- Basic SFTP deployment functionality
- Profile management
- SSH agent integration

### 0.0.1
- Initial release with basic SFTP capabilities
