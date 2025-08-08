// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { Client, SFTPWrapper } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Configuration file path
const DEPLOYMENTS_FILE = path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', '.vscode', 'deployments.sftp.json');

interface DeploymentProfile {
    name: string;
    host: string;
    port: number;
    username: string;
    remotePath: string;
    deployOnSave?: boolean;
    authMethod: 'ssh-key' | 'password';
    privateKeyPath?: string; // Path to private key file
    passphrase?: string; // For encrypted private keys
}

interface SSHConfig {
    host: string;
    port: number;
    username: string;
    privateKey?: string;
    passphrase?: string;
    password?: string;
    agent?: string;
}

function readProfiles(): DeploymentProfile[] {
    try {
        if (fs.existsSync(DEPLOYMENTS_FILE)) {
            const raw = fs.readFileSync(DEPLOYMENTS_FILE, 'utf8');
            const data = JSON.parse(raw);
            return Array.isArray(data.deployments) ? data.deployments : [];
        }
    } catch (e) {
        vscode.window.showErrorMessage('Failed to read SFTP deployments: ' + e);
    }
    return [];
}

function writeProfiles(profiles: DeploymentProfile[]) {
    try {
        const dir = path.dirname(DEPLOYMENTS_FILE);
        if (!fs.existsSync(dir)) {fs.mkdirSync(dir, { recursive: true });}
        fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify({ deployments: profiles }, null, 2));
    } catch (e) {
        vscode.window.showErrorMessage('Failed to write SFTP deployments: ' + e);
    }
}

let currentProfileIndex = 0;
let statusBarItem: vscode.StatusBarItem;

// Helper to get password/passphrase from SecretStorage
async function getSecret(context: vscode.ExtensionContext, key: string): Promise<string | undefined> {
    return await context.secrets.get(key);
}

// Helper to set password/passphrase in SecretStorage
async function setSecret(context: vscode.ExtensionContext, key: string, value: string) {
    await context.secrets.store(key, value);
}

// Helper to delete secret from SecretStorage
async function deleteSecret(context: vscode.ExtensionContext, key: string) {
    await context.secrets.delete(key);
}

// Get SSH configuration for a profile
async function getSSHConfig(context: vscode.ExtensionContext, profile: DeploymentProfile): Promise<SSHConfig> {
    const config: SSHConfig = {
        host: profile.host,
        port: profile.port,
        username: profile.username
    };

    if (profile.authMethod === 'ssh-key') {
        if (profile.privateKeyPath) {
            try {
                config.privateKey = fs.readFileSync(profile.privateKeyPath, 'utf8');
                if (profile.passphrase) {
                    config.passphrase = await getSecret(context, `sftp-passphrase-${profile.name}`);
                }
            } catch (e) {
                throw new Error(`Failed to read private key: ${e}`);
            }
        } else {
            // Try to use SSH agent
            config.agent = process.env.SSH_AUTH_SOCK;
        }
    } else {
        // Password authentication
        const password = await getSecret(context, `sftp-password-${profile.name}`);
        if (password) {
            config.password = password;
        }
    }

    return config;
}

// Create SFTP connection
async function createSFTPConnection(context: vscode.ExtensionContext, profile: DeploymentProfile): Promise<{ client: Client, sftp: SFTPWrapper }> {
    return new Promise((resolve, reject) => {
        const client = new Client();
        
        client.on('ready', () => {
            client.sftp((err: Error | undefined, sftp: SFTPWrapper) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ client, sftp });
            });
        });

        client.on('error', (err: Error) => {
            reject(err);
        });

        getSSHConfig(context, profile).then(config => {
            client.connect(config);
        }).catch(reject);
    });
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "deployment-sftp" is now active!');

    // Status bar setup
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'deployment-sftp.switchProfile';
    updateStatusBar(readProfiles());
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Switch profile command
    context.subscriptions.push(vscode.commands.registerCommand('deployment-sftp.switchProfile', () => {
        const profiles = readProfiles();
        if (profiles.length === 0) {
            vscode.window.showWarningMessage('No SFTP deployment profiles found.');
            return;
        }
        vscode.window.showQuickPick(profiles.map((p, i) => ({ 
            label: p.name, 
            description: `${p.host}:${p.port} (${p.authMethod})`, 
            index: i 
        })), {
            placeHolder: 'Select deployment profile',
        }).then(selected => {
            if (selected) {
                currentProfileIndex = selected.index;
                updateStatusBar(profiles);
            }
        });
    }));

    // Add profile command
    context.subscriptions.push(vscode.commands.registerCommand('deployment-sftp.addProfile', async () => {
        const name = await vscode.window.showInputBox({ prompt: 'Profile name' });
        if (!name) {return;}
        
        const host = await vscode.window.showInputBox({ prompt: 'Host' });
        if (!host) {return;}
        
        const portStr = await vscode.window.showInputBox({ prompt: 'Port', value: '22' });
        if (!portStr) {return;}
        const port = parseInt(portStr, 10);
        
        const username = await vscode.window.showInputBox({ prompt: 'Username' });
        if (!username) {return;}
        
        const remotePath = await vscode.window.showInputBox({ prompt: 'Remote path', value: '/' });
        if (!remotePath) {return;}

        const authMethod = await vscode.window.showQuickPick([
            { label: 'SSH Key', value: 'ssh-key' },
            { label: 'Password', value: 'password' }
        ], {
            placeHolder: 'Select authentication method'
        });
        if (!authMethod) {return;}

        let privateKeyPath: string | undefined;
        let passphrase: string | undefined;

        if (authMethod?.value === 'ssh-key') {
            const useCustomKey = await vscode.window.showQuickPick([
                { label: 'Use SSH Agent', value: 'agent' },
                { label: 'Custom Private Key', value: 'custom' }
            ], {
                placeHolder: 'Select key source'
            });
            
            if (useCustomKey?.value === 'custom') {
                const keyPath = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectMany: false,
                    openLabel: 'Select Private Key File'
                });
                if (keyPath && keyPath.length > 0) {
                    privateKeyPath = keyPath[0].fsPath;
                    passphrase = await vscode.window.showInputBox({ 
                        prompt: 'Passphrase (leave empty if none)', 
                        password: true 
                    });
                }
            }
        }

        const deployOnSave = await vscode.window.showQuickPick([
            { label: 'Yes', value: 'yes' },
            { label: 'No', value: 'no' }
        ], {
            placeHolder: 'Deploy on save?'
        });

        const profiles = readProfiles();
        const newProfile: DeploymentProfile = {
            name,
            host,
            port,
            username,
            remotePath,
            authMethod: authMethod?.value as 'ssh-key' | 'password',
            privateKeyPath,
            deployOnSave: deployOnSave?.value === 'yes'
        };

        profiles.push(newProfile);
        writeProfiles(profiles);

        // Store passphrase if provided
        if (passphrase) {
            await setSecret(context, `sftp-passphrase-${name}`, passphrase);
        }

        vscode.window.showInformationMessage(`Added SFTP profile: ${name}`);
        updateStatusBar(profiles);
    }));

    // Edit profile command
    context.subscriptions.push(vscode.commands.registerCommand('deployment-sftp.editProfile', async () => {
        let profiles = readProfiles();
        if (profiles.length === 0) {
            vscode.window.showWarningMessage('No SFTP deployment profiles to edit.');
            return;
        }
        
        const selected = await vscode.window.showQuickPick(profiles.map((p, i) => ({ 
            label: p.name, 
            description: `${p.host}:${p.port} (${p.authMethod})`, 
            index: i 
        })), { 
            placeHolder: 'Select profile to edit' 
        });
        
        if (!selected) {return;}
        
        const profile = profiles[selected.index];
        
        // Similar to add profile but with current values
        const name = await vscode.window.showInputBox({ prompt: 'Profile name', value: profile.name });
        if (!name) {return;}
        
        const host = await vscode.window.showInputBox({ prompt: 'Host', value: profile.host });
        if (!host) {return;}
        
        const portStr = await vscode.window.showInputBox({ prompt: 'Port', value: profile.port.toString() });
        if (!portStr) {return;}
        const port = parseInt(portStr, 10);
        
        const username = await vscode.window.showInputBox({ prompt: 'Username', value: profile.username });
        if (!username) {return;}
        
        const remotePath = await vscode.window.showInputBox({ prompt: 'Remote path', value: profile.remotePath });
        if (!remotePath) {return;}

        const authMethod = await vscode.window.showQuickPick([
            { label: 'SSH Key', value: 'ssh-key' },
            { label: 'Password', value: 'password' }
        ], {
            placeHolder: 'Select authentication method'
        });
        if (!authMethod) {return;}

        let privateKeyPath = profile.privateKeyPath;
        let passphrase: string | undefined;

        if (authMethod.value === 'ssh-key') {
            const useCustomKey = await vscode.window.showQuickPick([
                { label: 'Use SSH Agent', value: 'agent' },
                { label: 'Custom Private Key', value: 'custom' }
            ], {
                placeHolder: 'Select key source'
            });
            
            if (useCustomKey?.value === 'custom') {
                const keyPath = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectMany: false,
                    openLabel: 'Select Private Key File'
                });
                if (keyPath && keyPath.length > 0) {
                    privateKeyPath = keyPath[0].fsPath;
                    passphrase = await vscode.window.showInputBox({ 
                        prompt: 'Passphrase (leave empty if none)', 
                        password: true 
                    });
                }
            }
        }

        const deployOnSave = await vscode.window.showQuickPick([
            { label: 'Yes', value: 'yes' },
            { label: 'No', value: 'no' }
        ], {
            placeHolder: 'Deploy on save?'
        });

        const updatedProfile: DeploymentProfile = {
            name,
            host,
            port,
            username,
            remotePath,
            authMethod: authMethod.value as 'ssh-key' | 'password',
            privateKeyPath,
            deployOnSave: deployOnSave?.value === 'yes'
        };

        profiles[selected.index] = updatedProfile;
        writeProfiles(profiles);

        // Update passphrase if provided
        if (passphrase !== undefined) {
            if (passphrase) {
                await setSecret(context, `sftp-passphrase-${name}`, passphrase);
            } else {
                await deleteSecret(context, `sftp-passphrase-${name}`);
            }
        }

        vscode.window.showInformationMessage(`Edited SFTP profile: ${name}`);
        updateStatusBar(profiles);
    }));

    // Remove profile command
    context.subscriptions.push(vscode.commands.registerCommand('deployment-sftp.removeProfile', async () => {
        let profiles = readProfiles();
        if (profiles.length === 0) {
            vscode.window.showWarningMessage('No SFTP deployment profiles to remove.');
            return;
        }
        
        const selected = await vscode.window.showQuickPick(profiles.map((p, i) => ({ 
            label: p.name, 
            description: `${p.host}:${p.port}`, 
            index: i 
        })), { 
            placeHolder: 'Select profile to remove' 
        });
        
        if (!selected) {return;}
        
        const removed = profiles.splice(selected.index, 1);
        writeProfiles(profiles);
        
        // Delete secrets
        await deleteSecret(context, `sftp-password-${removed[0].name}`);
        await deleteSecret(context, `sftp-passphrase-${removed[0].name}`);
        
        vscode.window.showInformationMessage(`Removed SFTP profile: ${removed[0].name}`);
        updateStatusBar(profiles);
    }));

    // Deploy file command
    context.subscriptions.push(vscode.commands.registerCommand('deployment-sftp.deployFile', async (uri: vscode.Uri) => {
        const profiles = readProfiles();
        if (profiles.length === 0) {
            vscode.window.showWarningMessage('No SFTP deployment profiles found.');
            return;
        }
        
        const profile = profiles[currentProfileIndex] || profiles[0];
        const localPath = uri.fsPath;
        
        try {
            await vscode.window.withProgress({ 
                location: vscode.ProgressLocation.Notification, 
                title: `Deploying file to ${profile.name}...` 
            }, async () => {
                const { client, sftp } = await createSFTPConnection(context, profile);
                const remoteTarget = profile.remotePath.endsWith('/') ? profile.remotePath : profile.remotePath + '/';
                const remoteFile = remoteTarget + path.basename(localPath);
                
                return new Promise<void>((resolve, reject) => {
                    sftp.fastPut(localPath, remoteFile, (err: Error | null | undefined) => {
                        client.end();
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
            });
            vscode.window.showInformationMessage(`Deployed file to ${profile.name}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Deploy failed: ${error.message}`);
        }
    }));

    // Download file command
    context.subscriptions.push(vscode.commands.registerCommand('deployment-sftp.downloadFile', async (uri: vscode.Uri) => {
        const profiles = readProfiles();
        if (profiles.length === 0) {
            vscode.window.showWarningMessage('No SFTP deployment profiles found.');
            return;
        }
        
        const profile = profiles[currentProfileIndex] || profiles[0];
        const localPath = uri.fsPath;
        const remoteTarget = profile.remotePath.endsWith('/') ? profile.remotePath : profile.remotePath + '/';
        const remoteFile = remoteTarget + path.basename(localPath);
        
        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(localPath),
            filters: {
                'All Files': ['*']
            }
        });
        
        if (!saveUri) {return;}
        
        try {
            await vscode.window.withProgress({ 
                location: vscode.ProgressLocation.Notification, 
                title: `Downloading file from ${profile.name}...` 
            }, async () => {
                const { client, sftp } = await createSFTPConnection(context, profile);
                
                return new Promise<void>((resolve, reject) => {
                    sftp.fastGet(remoteFile, saveUri.fsPath, (err: Error | null | undefined) => {
                        client.end();
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
            });
            vscode.window.showInformationMessage(`Downloaded file from ${profile.name}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Download failed: ${error.message}`);
        }
    }));

    // Delete file command
    context.subscriptions.push(vscode.commands.registerCommand('deployment-sftp.deleteFile', async (uri: vscode.Uri) => {
        const profiles = readProfiles();
        if (profiles.length === 0) {
            vscode.window.showWarningMessage('No SFTP deployment profiles found.');
            return;
        }
        
        const profile = profiles[currentProfileIndex] || profiles[0];
        const localPath = uri.fsPath;
        const remoteTarget = profile.remotePath.endsWith('/') ? profile.remotePath : profile.remotePath + '/';
        const remoteFile = remoteTarget + path.basename(localPath);
        
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete ${path.basename(localPath)} from ${profile.name}?`,
            'Yes', 'No'
        );
        
        if (confirm !== 'Yes') {return;}
        
        try {
            await vscode.window.withProgress({ 
                location: vscode.ProgressLocation.Notification, 
                title: `Deleting file from ${profile.name}...` 
            }, async () => {
                const { client, sftp } = await createSFTPConnection(context, profile);
                
                return new Promise<void>((resolve, reject) => {
                    sftp.unlink(remoteFile, (err: Error | null | undefined) => {
                        client.end();
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
            });
            vscode.window.showInformationMessage(`Deleted file from ${profile.name}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Delete failed: ${error.message}`);
        }
    }));

    // Diff file command
    context.subscriptions.push(vscode.commands.registerCommand('deployment-sftp.diffFile', async (uri: vscode.Uri) => {
        const profiles = readProfiles();
        if (profiles.length === 0) {
            vscode.window.showWarningMessage('No SFTP deployment profiles found.');
            return;
        }
        
        const profile = profiles[currentProfileIndex] || profiles[0];
        const localPath = uri.fsPath;
        const remoteTarget = profile.remotePath.endsWith('/') ? profile.remotePath : profile.remotePath + '/';
        const remoteFile = remoteTarget + path.basename(localPath);
        const tmpRemotePath = path.join(os.tmpdir(), `sftp-remote-${Date.now()}-${path.basename(localPath)}`);
        
        try {
            await vscode.window.withProgress({ 
                location: vscode.ProgressLocation.Notification, 
                title: `Downloading remote file for diff...` 
            }, async () => {
                const { client, sftp } = await createSFTPConnection(context, profile);
                
                return new Promise<void>((resolve, reject) => {
                    sftp.fastGet(remoteFile, tmpRemotePath, (err: Error | null | undefined) => {
                        client.end();
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
            });
            const left = vscode.Uri.file(localPath);
            const right = vscode.Uri.file(tmpRemotePath);
            vscode.commands.executeCommand('vscode.diff', left, right, `Local ↔ Remote: ${path.basename(localPath)}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Diff failed: ${error.message}`);
        }
    }));

    // Manage profiles webview
    context.subscriptions.push(vscode.commands.registerCommand('deployment-sftp.manageProfiles', async () => {
        const panel = vscode.window.createWebviewPanel(
            'sftpProfiles',
            'Manage SFTP Profiles',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        function getHtml(profiles: DeploymentProfile[], editingIndex: number | null = null, editingProfile: any = {}) {
            const profileRows = profiles.map((p, i) => `
                <tr>
                    <td>${p.name}</td>
                    <td>${p.host}:${p.port}</td>
                    <td>${p.username}</td>
                    <td>${p.remotePath}</td>
                    <td>${p.authMethod}</td>
                    <td>${p.deployOnSave ? 'Yes' : 'No'}</td>
                    <td>
                        <button onclick="editProfile(${i})">Edit</button>
                        <button onclick="removeProfile(${i})">Remove</button>
                    </td>
                </tr>
            `).join('');
            
            const editing = editingIndex !== null;
            return `
                <html>
                <head>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; }
                        table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #f2f2f2; }
                        button { margin: 2px; padding: 4px 8px; }
                        .form-group { margin: 10px 0; }
                        label { display: inline-block; width: 120px; }
                        input, select { width: 200px; padding: 4px; }
                    </style>
                </head>
                <body>
                    <h2>SFTP Profiles</h2>
                    <table>
                        <tr>
                            <th>Name</th>
                            <th>Host:Port</th>
                            <th>Username</th>
                            <th>Remote Path</th>
                            <th>Auth Method</th>
                            <th>Deploy on Save</th>
                            <th>Actions</th>
                        </tr>
                        ${profileRows}
                    </table>
                    <button onclick="addProfile()">Add Profile</button>
                    <hr/>
                    <div id="formDiv" style="display:${editing ? 'block' : 'none'};border:1px solid #ccc;padding:10px;">
                        <h3>${editingIndex === null ? 'Add' : 'Edit'} Profile</h3>
                        <form id="profileForm">
                            <div class="form-group">
                                <label>Name:</label>
                                <input name="name" value="${editingProfile.name || ''}" required />
                            </div>
                            <div class="form-group">
                                <label>Host:</label>
                                <input name="host" value="${editingProfile.host || ''}" required />
                            </div>
                            <div class="form-group">
                                <label>Port:</label>
                                <input name="port" value="${editingProfile.port || 22}" required type="number" />
                            </div>
                            <div class="form-group">
                                <label>Username:</label>
                                <input name="username" value="${editingProfile.username || ''}" required />
                            </div>
                            <div class="form-group">
                                <label>Remote Path:</label>
                                <input name="remotePath" value="${editingProfile.remotePath || '/'}" required />
                            </div>
                            <div class="form-group">
                                <label>Auth Method:</label>
                                <select name="authMethod">
                                    <option value="ssh-key" ${editingProfile.authMethod === 'ssh-key' ? 'selected' : ''}>SSH Key</option>
                                    <option value="password" ${editingProfile.authMethod === 'password' ? 'selected' : ''}>Password</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Deploy on Save:</label>
                                <input name="deployOnSave" type="checkbox" ${editingProfile.deployOnSave ? 'checked' : ''} />
                            </div>
                            <input type="hidden" name="editingIndex" value="${editingIndex !== null ? editingIndex : ''}" />
                            <button type="submit">${editingIndex === null ? 'Add' : 'Save'}</button>
                            <button type="button" onclick="cancelEdit()">Cancel</button>
                        </form>
                    </div>
                    <script>
                        const vscode = acquireVsCodeApi();
                        function addProfile() {
                            document.getElementById('formDiv').style.display = 'block';
                            document.getElementById('profileForm').reset();
                            document.querySelector('input[name=editingIndex]').value = '';
                        }
                        function editProfile(idx) {
                            vscode.postMessage({ type: 'edit', index: idx });
                        }
                        function removeProfile(idx) {
                            if (confirm('Are you sure you want to remove this profile?')) {
                                vscode.postMessage({ type: 'remove', index: idx });
                            }
                        }
                        function cancelEdit() {
                            document.getElementById('formDiv').style.display = 'none';
                        }
                        document.getElementById('profileForm')?.addEventListener('submit', (e) => {
                            e.preventDefault();
                            const data = Object.fromEntries(new FormData(e.target).entries());
                            data.deployOnSave = e.target.deployOnSave.checked;
                            vscode.postMessage({ type: 'save', data });
                        });
                    </script>
                </body>
                </html>
            `;
        }

        let profiles = readProfiles();
        let editingIndex: number | null = null;
        let editingProfile: any = {};

        async function updateWebview() {
            if (editingIndex !== null) {
                editingProfile = { ...profiles[editingIndex] };
            } else {
                editingProfile = {};
            }
            panel.webview.html = getHtml(profiles, editingIndex, editingProfile);
        }

        panel.webview.onDidReceiveMessage(async msg => {
            if (msg.type === 'edit') {
                editingIndex = msg.index;
                await updateWebview();
            } else if (msg.type === 'remove') {
                const removed = profiles.splice(msg.index, 1);
                writeProfiles(profiles);
                await deleteSecret(context, `sftp-password-${removed[0].name}`);
                await deleteSecret(context, `sftp-passphrase-${removed[0].name}`);
                editingIndex = null;
                await updateWebview();
            } else if (msg.type === 'save') {
                const { name, host, port, username, remotePath, authMethod, editingIndex: idx, deployOnSave } = msg.data;
                const profileObj = { 
                    name, 
                    host, 
                    port: parseInt(port, 10), 
                    username, 
                    remotePath, 
                    authMethod,
                    deployOnSave: !!deployOnSave 
                };
                
                if (idx === '' || idx === undefined) {
                    profiles.push(profileObj);
                } else {
                    profiles[parseInt(idx, 10)] = profileObj;
                }
                
                writeProfiles(profiles);
                editingIndex = null;
                await updateWebview();
                updateStatusBar(profiles);
            }
        });

        await updateWebview();
    }));

    // Deploy on save event
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document) => {
        const profiles = readProfiles();
        if (profiles.length === 0) {return;}
        
        const profile = profiles[currentProfileIndex] || profiles[0];
        if (!profile.deployOnSave) {return;}
        
        const localPath = document.fileName;
        
        try {
            await vscode.window.withProgress({ 
                location: vscode.ProgressLocation.Notification, 
                title: `Auto-deploying file to ${profile.name}...` 
            }, async () => {
                const { client, sftp } = await createSFTPConnection(context, profile);
                const remoteTarget = profile.remotePath.endsWith('/') ? profile.remotePath : profile.remotePath + '/';
                const remoteFile = remoteTarget + path.basename(localPath);
                
                return new Promise<void>((resolve, reject) => {
                    sftp.fastPut(localPath, remoteFile, (err: Error | null | undefined) => {
                        client.end();
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
            });
            vscode.window.showInformationMessage(`Auto-deployed file to ${profile.name}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Auto-deploy failed: ${error.message}`);
        }
    }));
}

function updateStatusBar(profiles: DeploymentProfile[]) {
    if (profiles.length === 0) {
        statusBarItem.text = 'SFTP: No Profile';
        statusBarItem.tooltip = 'No SFTP deployment profiles configured.';
    } else {
        const profile = profiles[currentProfileIndex] || profiles[0];
        statusBarItem.text = `SFTP: ${profile.name}`;
        statusBarItem.tooltip = `Active SFTP profile: ${profile.name} (${profile.host}:${profile.port})`;
    }
}

export function deactivate() {}
