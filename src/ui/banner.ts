import pc from 'picocolors';

export function printBanner(options: {
  version: string;
  provider?: string;
  model: string;
  workspace: string;
  yolo: boolean;
  planMode?: boolean;
}): void {
  const logo = `
   ____          _        _                 _                 
  / ___|___   __| | ___  | |    __ _ _ __  | |_ ___ _ __ _ __  
 | |   / _ \\ / _\` |/ _ \\ | |   / _\` | '_ \\ | __/ _ \\ '__| '_ \\ 
 | |__| (_) | (_| |  __/ | |__| (_| | | | || ||  __/ |  | | | |
  \\____\\___/ \\__,_|\\___| |_____\\__,_|_| |_(_)__\\___|_|  |_| |_|
   🏮 Personal AI Coding Assistant for Terminal (Multi-Provider)
`;

  console.log(pc.yellow(logo));
  console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));
  const providerDisplay = options.provider ? `${pc.bold('Provider:')} ${pc.magenta(options.provider)}  ` : '';
  console.log(`${pc.bold('Product:')}    Code Lantern CLI (${pc.cyan('lantern')})  ${pc.bold('Version:')} ${options.version}`);
  console.log(`${providerDisplay}${pc.bold('Model:')} ${pc.green(options.model)}`);
  console.log(`${pc.bold('Workspace:')}  ${pc.blue(options.workspace)}`);

  const modeBadge = options.planMode
    ? pc.bgBlue(pc.white(' PLAN MODE (Read-only) '))
    : options.yolo
    ? pc.bgRed(pc.white(' YOLO MODE (Auto-approve) '))
    : pc.bgGreen(pc.black(' SAFE MODE (Approval Prompts) '));

  console.log(`${pc.bold('Status:')}     ${modeBadge}`);
  console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));
  console.log(pc.dim(`Type your task or question. Use ${pc.bold(pc.yellow('/help'))} for commands, ${pc.bold(pc.yellow('/exit'))} to quit.`));
  console.log(pc.dim(`Multiline tip: End a line with '\\' or enclose in '"""' for multiline blocks.\n`));
}
