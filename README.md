# deployment-sftp

A Visual Studio Code extension for managing SFTP deployment profiles and deploying files or folders to remote servers using your system's SSH agent (no passwords stored in project).

## Features
- Store multiple SFTP deployment profiles in `.vscode/deployments.sftp.json` (array format)
- Switch between deployment profiles using a status bar item
- Add, edit, and remove deployment profiles via commands
- Deploy files or folders to the selected remote server using SSH agent authentication (no password stored)
- Emulates the SSH/Deployment workflow of IntelliJ/PHPStorm

## Requirements
- SSH keys must be configured in your system's `~/.ssh` directory and loaded in your SSH agent
- No passwords are stored in the project or deployment JSON

## Usage
1. Use the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`) and search for:
   - `Add SFTP Deployment Profile`
   - `Edit SFTP Deployment Profile`
   - `Remove SFTP Deployment Profile`
   - `Switch SFTP Deployment Profile`
   - `Deploy SFTP`
2. The status bar at the bottom will show the current profile. Click it to switch profiles.
3. Deploy files or folders by running the deploy command and selecting the local path.

## Extension Settings
This extension does not add any custom settings yet.

## Known Issues
- Only agent-based SSH authentication is supported (no password prompt)
- No advanced sync or diff features yet

## Release Notes
### 0.0.1
- Initial release with profile management and SFTP deployment
