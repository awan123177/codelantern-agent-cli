import pc from 'picocolors';
import { SkillManager } from '../skills/skillManager.js';

export async function skillsCommand(
  action?: string,
  target?: string
): Promise<void> {
  const manager = new SkillManager();
  const subAction = (action || 'list').toLowerCase();

  if (subAction === 'list') {
    const skills = manager.listSkills();
    console.log('\n' + pc.bold(pc.yellow('🏮 Installed Code Lantern Skills')));
    console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));
    console.log(
      pc.bold('Skill Name'.padEnd(24)) +
      pc.bold('Source'.padEnd(12)) +
      pc.bold('Status'.padEnd(14)) +
      pc.bold('Description')
    );
    console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));

    if (skills.length === 0) {
      console.log(pc.dim('No skills currently installed.'));
      console.log(pc.dim(`\nAdd a skill using: lantern skills add <local-folder-or-git-url>`));
      console.log(pc.dim(`User skills folder: ${manager.getUserSkillsDir()}\n`));
      return;
    }

    for (const s of skills) {
      const statusText = s.enabled ? pc.green('✓ Active') : pc.dim('Disabled');
      const sourceText = s.source === 'project' ? pc.cyan('[project]') : pc.blue('[user]');

      console.log(
        pc.bold(s.name.padEnd(24)) +
        sourceText.padEnd(20) +
        statusText.padEnd(22) +
        pc.dim(s.description.slice(0, 40))
      );
    }

    console.log(pc.dim('\nTo inspect: lantern skills show <name>'));
    console.log(pc.dim('To enable:  lantern skills enable <name>'));
    console.log(pc.dim('To disable: lantern skills disable <name>'));
    console.log(pc.dim('To add:     lantern skills add <folder-path-or-git-url>\n'));
    return;
  }

  if (subAction === 'show') {
    if (!target) {
      console.error(pc.red('Error: Missing skill name. Usage: lantern skills show <name>'));
      process.exit(1);
    }

    const skill = manager.getSkill(target);
    if (!skill) {
      console.error(pc.red(`Error: Skill '${target}' not found.`));
      process.exit(1);
    }

    console.log('\n' + pc.bold(pc.yellow(`🏮 Skill: ${skill.name}`)));
    console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));
    console.log(`${pc.bold('Source:')}      ${skill.source}`);
    console.log(`${pc.bold('Path:')}        ${skill.path}`);
    console.log(`${pc.bold('Status:')}      ${skill.enabled ? pc.green('Enabled') : pc.dim('Disabled')}`);
    console.log(`${pc.bold('Description:')} ${skill.description}`);
    if (skill.references && skill.references.length > 0) {
      console.log(`${pc.bold('References:')}  ${skill.references.length} reference file(s) available`);
    }
    console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));
    console.log('\n' + pc.cyan('Instructions Content:'));
    console.log(skill.content.slice(0, 1000) + (skill.content.length > 1000 ? '\n... (truncated)' : ''));
    console.log('');
    return;
  }

  if (subAction === 'enable') {
    if (!target) {
      console.error(pc.red('Error: Missing skill name. Usage: lantern skills enable <name>'));
      process.exit(1);
    }

    const skill = manager.getSkill(target);
    if (!skill) {
      console.error(pc.red(`Error: Skill '${target}' not found.`));
      process.exit(1);
    }

    manager.enableSkill(skill.name);
    console.log(pc.green(`✓ Enabled skill '${skill.name}'`));
    return;
  }

  if (subAction === 'disable') {
    if (!target) {
      console.error(pc.red('Error: Missing skill name. Usage: lantern skills disable <name>'));
      process.exit(1);
    }

    manager.disableSkill(target);
    console.log(pc.yellow(`✓ Disabled skill '${target}'`));
    return;
  }

  if (subAction === 'add') {
    if (!target) {
      console.error(pc.red('Error: Missing path or repository URL. Usage: lantern skills add <path-or-git-url>'));
      process.exit(1);
    }

    console.log(`Adding skill from '${target}'...`);
    const isGit = target.startsWith('http://') || target.startsWith('https://') || target.startsWith('git@');
    const result = isGit ? manager.addSkillFromGit(target) : manager.addSkillFromPath(target);

    if (result.success) {
      console.log(pc.green(`✓ Successfully added and enabled skill '${result.skillName}'`));
    } else {
      console.error(pc.red(`✗ Failed to add skill: ${result.error}`));
      process.exit(1);
    }
    return;
  }

  if (subAction === 'remove' || subAction === 'rm') {
    if (!target) {
      console.error(pc.red('Error: Missing skill name. Usage: lantern skills remove <name>'));
      process.exit(1);
    }

    const removed = manager.removeSkill(target);
    if (removed) {
      console.log(pc.green(`✓ Removed skill '${target}'`));
    } else {
      console.error(pc.red(`✗ Skill '${target}' not found or could not be removed.`));
      process.exit(1);
    }
    return;
  }

  console.error(pc.red(`Unknown action '${action}'. Available: list, show, add, enable, disable, remove`));
  process.exit(1);
}
