// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { Client, SFTPWrapper } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
const DEPLOYMENTS_FILE = path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', '.vscode', 'deployments.sftp.json');

interface DeploymentProfile {
    name: string;
    host: string;
    port: number;
    username: string;
    remotePath: string;
    // No password field
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
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify({ deployments: profiles }, null, 2));
    } catch (e) {
        vscode.window.showErrorMessage('Failed to write SFTP deployments: ' + e);
    }
}

let currentProfileIndex = 0;
let statusBarItem: vscode.StatusBarItem;

// Helper to get password from SecretStorage
async function getProfilePassword(context: vscode.ExtensionContext, profileName: string): Promise<string | undefined> {
    return await context.secrets.get(`sftp-password-${profileName}`);
}

// Helper to set password in SecretStorage
async function setProfilePassword(context: vscode.ExtensionContext, profileName: string, password: string) {
    await context.secrets.store(`sftp-password-${profileName}`, password);
}

export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "deployment-sftp" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('deployment-sftp.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from deployment-sftp!');
	});

	context.subscriptions.push(disposable);

	const profiles = readProfiles();
	// Move status bar to the right
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'deployment-sftp.switchProfile';
	updateStatusBar(profiles);
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	context.subscriptions.push(vscode.commands.registerCommand('deployment-sftp.switchProfile', () => {
		const profiles = readProfiles();
		if (profiles.length === 0) {
			vscode.window.showWarningMessage('No SFTP deployment profiles found.');
			return;
		}
		vscode.window.showQuickPick(profiles.map((p, i) => ({ label: p.name, description: p.host, index: i })), {
			placeHolder: 'Select deployment profile',
		}).then(selected => {
			if (selected) {
				currentProfileIndex = selected.index;
				updateStatusBar(profiles);
			}
		});
	}));

	// Add deployment profile
	context.subscriptions.push(vscode.commands.registerCommand('deployment-sftp.addProfile', async () => {
		const name = await vscode.window.showInputBox({ prompt: 'Profile name' });
		if (!name) return;
		const host = await vscode.window.showInputBox({ prompt: 'Host' });
		if (!host) return;
		const portStr = await vscode.window.showInputBox({ prompt: 'Port', value: '22' });
		if (!portStr) return;
		const port = parseInt(portStr, 10);
		const username = await vscode.window.showInputBox({ prompt: 'Username' });
		if (!username) return;
		const remotePath = await vscode.window.showInputBox({ prompt: 'Remote path', value: '/' });
		if (!remotePath) return;
		const profiles = readProfiles();
		profiles.push({ name, host, port, username, remotePath });
		writeProfiles(profiles);
		vscode.window.showInformationMessage(`Added SFTP profile: ${name}`);
		updateStatusBar(profiles);
	}));

	// Edit deployment profile
	context.subscriptions.push(vscode.commands.registerCommand('deployment-sftp.editProfile', async () => {
		let profiles = readProfiles();
		if (profiles.length === 0) {
			vscode.window.showWarningMessage('No SFTP deployment profiles to edit.');
			return;
		}
		const selected = await vscode.window.showQuickPick(profiles.map((p, i) => ({ label: p.name, description: p.host, index: i })), { placeHolder: 'Select profile to edit' });
		if (!selected) return;
		const profile = profiles[selected.index];
		const name = await vscode.window.showInputBox({ prompt: 'Profile name', value: profile.name });
		if (!name) return;
		const host = await vscode.window.showInputBox({ prompt: 'Host', value: profile.host });
		if (!host) return;
		const portStr = await vscode.window.showInputBox({ prompt: 'Port', value: profile.port.toString() });
		if (!portStr) return;
		const port = parseInt(portStr, 10);
		const username = await vscode.window.showInputBox({ prompt: 'Username', value: profile.username });
		if (!username) return;
		const remotePath = await vscode.window.showInputBox({ prompt: 'Remote path', value: profile.remotePath });
		if (!remotePath) return;
		profiles[selected.index] = { name, host, port, username, remotePath };
		writeProfiles(profiles);
		vscode.window.showInformationMessage(`Edited SFTP profile: ${name}`);
		updateStatusBar(profiles);
	}));

	// Remove deployment profile
	context.subscriptions.push(vscode.commands.registerCommand('deployment-sftp.removeProfile', async () => {
		let profiles = readProfiles();
		if (profiles.length === 0) {
			vscode.window.showWarningMessage('No SFTP deployment profiles to remove.');
			return;
		}
		const selected = await vscode.window.showQuickPick(profiles.map((p, i) => ({ label: p.name, description: p.host, index: i })), { placeHolder: 'Select profile to remove' });
		if (!selected) return;
		const removed = profiles.splice(selected.index, 1);
		writeProfiles(profiles);
		vscode.window.showInformationMessage(`Removed SFTP profile: ${removed[0].name}`);
		updateStatusBar(profiles);
	}));

	// Deploy command
	context.subscriptions.push(vscode.commands.registerCommand('deployment-sftp.deploy', async () => {
		const profiles = readProfiles();
		if (profiles.length === 0) {
			vscode.window.showWarningMessage('No SFTP deployment profiles found.');
			return;
		}
		const profile = profiles[currentProfileIndex] || profiles[0];
		// Select file or folder to deploy
		const uri = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: 'Select file or folder to deploy'
		});
		if (!uri || uri.length === 0) return;
		const localPath = uri[0].fsPath;
		vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Deploying to ${profile.name}...` }, async (progress, token) => {
			return new Promise<void>((resolve, reject) => {
				const conn = new Client();
				conn.on('ready', () => {
					conn.sftp((err: Error | undefined, sftp: SFTPWrapper) => {
						if (err) {
							vscode.window.showErrorMessage('SFTP error: ' + err.message);
							conn.end();
							reject(err);
							return;
						}
						const fsStat = fs.statSync(localPath);
						const remoteTarget = profile.remotePath.endsWith('/') ? profile.remotePath : profile.remotePath + '/';
						if (fsStat.isFile()) {
							// Upload file
							const remoteFile = remoteTarget + path.basename(localPath);
							sftp.fastPut(localPath, remoteFile, (err: Error | null | undefined) => {
								if (err) {
									vscode.window.showErrorMessage('Upload failed: ' + (err === null ? 'Unknown error' : err.message));
									conn.end();
									reject(err === null ? undefined : err);
								} else {
									vscode.window.showInformationMessage(`Deployed file to ${profile.name}`);
									conn.end();
									resolve();
								}
							});
						} else if (fsStat.isDirectory()) {
							// Recursively upload directory
							uploadDirectory(sftp, localPath, remoteTarget, (err: Error | undefined) => {
								if (err) {
									vscode.window.showErrorMessage('Directory upload failed: ' + err.message);
									conn.end();
									reject(err);
								} else {
									vscode.window.showInformationMessage(`Deployed folder to ${profile.name}`);
									conn.end();
									resolve();
								}
							});
						}
					});
				}).on('error', (err: Error) => {
					vscode.window.showErrorMessage('SSH connection error: ' + err.message);
					reject(err);
				}).connect({
					host: profile.host,
					port: profile.port,
					username: profile.username,
					agent: process.env.SSH_AUTH_SOCK,
					tryKeyboard: false
				});
			});
		});
	}));

	// Deploy a single file from context menu
	context.subscriptions.push(vscode.commands.registerCommand('deployment-sftp.deployFile', async (uri: vscode.Uri) => {
		const profiles = readProfiles();
		if (profiles.length === 0) {
			vscode.window.showWarningMessage('No SFTP deployment profiles found.');
			return;
		}
		const profile = profiles[currentProfileIndex] || profiles[0];
		const localPath = uri.fsPath;
		const password = await getProfilePassword(context, profile.name);
		vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Deploying file to ${profile.name}...` }, async () => {
			return new Promise<void>((resolve, reject) => {
				const conn = new Client();
				conn.on('ready', () => {
					conn.sftp((err: Error | undefined, sftp: SFTPWrapper) => {
						if (err) {
							vscode.window.showErrorMessage('SFTP error: ' + err.message);
							conn.end();
							reject(err);
							return;
						}
						const remoteTarget = profile.remotePath.endsWith('/') ? profile.remotePath : profile.remotePath + '/';
						const remoteFile = remoteTarget + path.basename(localPath);
						sftp.fastPut(localPath, remoteFile, (err: Error | null | undefined) => {
							if (err) {
								vscode.window.showErrorMessage('Upload failed: ' + (err === null ? 'Unknown error' : err.message));
								conn.end();
								reject(err === null ? undefined : err);
							} else {
								vscode.window.showInformationMessage(`Deployed file to ${profile.name}`);
								conn.end();
								resolve();
							}
						});
					});
				}).on('error', (err: Error) => {
					vscode.window.showErrorMessage('SSH connection error: ' + err.message);
					reject(err);
				}).connect({
					host: profile.host,
					port: profile.port,
					username: profile.username,
					password: password,
					agent: process.env.SSH_AUTH_SOCK,
					tryKeyboard: false
				});
			});
		});
	}));

	// Diff a file with its remote version
	context.subscriptions.push(vscode.commands.registerCommand('deployment-sftp.diffFile', async (uri: vscode.Uri) => {
		const profiles = readProfiles();
		if (profiles.length === 0) {
			vscode.window.showWarningMessage('No SFTP deployment profiles found.');
			return;
		}
		const profile = profiles[currentProfileIndex] || profiles[0];
		const localPath = uri.fsPath;
		const password = await getProfilePassword(context, profile.name);
		const remoteTarget = profile.remotePath.endsWith('/') ? profile.remotePath : profile.remotePath + '/';
		const remoteFile = remoteTarget + path.basename(localPath);
		const tmp = require('os').tmpdir();
		const tmpRemotePath = path.join(tmp, `sftp-remote-${Date.now()}-${path.basename(localPath)}`);
		vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Downloading remote file for diff...` }, async () => {
			return new Promise<void>((resolve, reject) => {
				const conn = new Client();
				conn.on('ready', () => {
					conn.sftp((err: Error | undefined, sftp: SFTPWrapper) => {
						if (err) {
							vscode.window.showErrorMessage('SFTP error: ' + err.message);
							conn.end();
							reject(err);
							return;
						}
						sftp.fastGet(remoteFile, tmpRemotePath, (err: Error | null | undefined) => {
							conn.end();
							if (err) {
								vscode.window.showErrorMessage('Failed to download remote file: ' + (err === null ? 'Unknown error' : err.message));
								reject(err === null ? undefined : err);
							} else {
								const left = vscode.Uri.file(localPath);
								const right = vscode.Uri.file(tmpRemotePath).with({ scheme: 'file' });
								vscode.commands.executeCommand('vscode.diff', left, right, `Local ↔ Remote: ${path.basename(localPath)}`);
								resolve();
							}
						});
					});
				}).on('error', (err: Error) => {
					vscode.window.showErrorMessage('SSH connection error: ' + err.message);
					reject(err);
				}).connect({
					host: profile.host,
					port: profile.port,
					username: profile.username,
					password: password,
					agent: process.env.SSH_AUTH_SOCK,
					tryKeyboard: false
				});
			});
		});
	}));

	// --- Manage Profiles Webview ---
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
					<td>${p.host}</td>
					<td>${p.port}</td>
					<td>${p.username}</td>
					<td>${p.remotePath}</td>
					<td>
						<button onclick="editProfile(${i})">Edit</button>
						<button onclick="removeProfile(${i})">Remove</button>
					</td>
				</tr>
			`).join('');
			const editing = editingIndex !== null;
			return `
				<html>
				<body>
					<h2>SFTP Profiles</h2>
					<table border="1" cellspacing="0" cellpadding="4">
						<tr><th>Name</th><th>Host</th><th>Port</th><th>Username</th><th>Remote Path</th><th>Actions</th></tr>
						${profileRows}
					</table>
					<br/>
					<button onclick="addProfile()">Add Profile</button>
					<hr/>
					<div id="formDiv" style="display:${editing ? 'block' : 'none'};border:1px solid #ccc;padding:10px;">
						<h3>${editingIndex === null ? 'Add' : 'Edit'} Profile</h3>
						<form id="profileForm">
							<label>Name: <input name="name" value="${editingProfile.name || ''}" required /></label><br/>
							<label>Host: <input name="host" value="${editingProfile.host || ''}" required /></label><br/>
							<label>Port: <input name="port" value="${editingProfile.port || 22}" required type="number" /></label><br/>
							<label>Username: <input name="username" value="${editingProfile.username || ''}" required /></label><br/>
							<label>Remote Path: <input name="remotePath" value="${editingProfile.remotePath || '/'}" required /></label><br/>
							<label>Password: <input name="password" type="password" value="${editingProfile.password || ''}" /></label><br/>
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
							vscode.postMessage({ type: 'remove', index: idx });
						}
						function cancelEdit() {
							document.getElementById('formDiv').style.display = 'none';
						}
						document.getElementById('profileForm')?.addEventListener('submit', (e) => {
							e.preventDefault();
							const data = Object.fromEntries(new FormData(e.target).entries());
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
				// If editing, fetch password from SecretStorage
				const prof = profiles[editingIndex];
				const password = await getProfilePassword(context, prof.name);
				editingProfile = { ...prof, password: password || '' };
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
				profiles.splice(msg.index, 1);
				writeProfiles(profiles);
				editingIndex = null;
				await updateWebview();
			} else if (msg.type === 'save') {
				const { name, host, port, username, remotePath, password, editingIndex: idx } = msg.data;
				const profileObj = { name, host, port: parseInt(port, 10), username, remotePath };
				if (idx === '' || idx === undefined) {
					profiles.push(profileObj);
				} else {
					profiles[parseInt(idx, 10)] = profileObj;
				}
				writeProfiles(profiles);
				if (password) {
					await setProfilePassword(context, name, password);
				}
				editingIndex = null;
				await updateWebview();
				updateStatusBar(profiles);
			}
		});
		await updateWebview();
	}));
}

function uploadDirectory(sftp: SFTPWrapper, localDir: string, remoteDir: string, cb: (err?: Error) => void) {
    fs.readdir(localDir, (err: NodeJS.ErrnoException | null, files: string[]) => {
        if (err) return cb(err);
        let i = 0;
        function next() {
            if (i >= files.length) return cb();
            const file = files[i++];
            const localPath = path.join(localDir, file);
            const remotePath = remoteDir + file;
            fs.stat(localPath, (err: NodeJS.ErrnoException | null, stat: fs.Stats) => {
                if (err) return cb(err);
                if (stat.isFile()) {
                    sftp.fastPut(localPath, remotePath, (err: Error | null | undefined) => {
                        if (err) return cb(err === null ? undefined : err);
                        next();
                    });
                } else if (stat.isDirectory()) {
                    sftp.mkdir(remotePath, { mode: 0o755 }, (err: Error | null | undefined) => {
                        // Ignore error if directory exists
                        next();
                    });
                    uploadDirectory(sftp, localPath, remotePath + '/', (err) => {
                        if (err) return cb(err);
                        next();
                    });
                } else {
                    next();
                }
            });
        }
        next();
    });
}

function updateStatusBar(profiles: DeploymentProfile[]) {
    if (profiles.length === 0) {
        statusBarItem.text = 'SFTP: No Profile';
        statusBarItem.tooltip = 'No SFTP deployment profiles configured.';
    } else {
        const profile = profiles[currentProfileIndex] || profiles[0];
        statusBarItem.text = `SFTP: ${profile.name}`;
        statusBarItem.tooltip = `Active SFTP profile: ${profile.name} (${profile.host})`;
    }
}

// This method is called when your extension is deactivated
export function deactivate() {}
