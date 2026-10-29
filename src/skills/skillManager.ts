import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { getLanternHomeDir, loadConfig, saveConfig } from '../config/config.js';
import type { Skill } from '../types.js';

export class SkillManager {
  private userSkillsDir: string;

  constructor() {
    this.userSkillsDir = path.join(getLanternHomeDir(), 'skills');
    if (!fs.existsSync(this.userSkillsDir)) {
      try {
        fs.mkdirSync(this.userSkillsDir, { recursive: true });
      } catch {
        // ignore
      }
    }
  }

  public getUserSkillsDir(): string {
    return this.userSkillsDir;
  }

  public getProjectSkillsDirs(workspace: string): string[] {
    return [
      path.join(workspace, '.codelantern', 'skills'),
      path.join(workspace, '.lantern', 'skills')
    ];
  }

  /**
   * Discovers all available skills from user-level and project-level directories
   */
  public listSkills(workspace = process.cwd()): Skill[] {
    const skillsMap: Map<string, Skill> = new Map();
    const config = loadConfig();
    const activeSkillsList = new Set(config.activeSkills || []);

    // 1. Load User-level skills
    this.scanDirectoryForSkills(this.userSkillsDir, 'user', skillsMap, activeSkillsList);

    // 2. Load Project-level skills (project-level overrides user-level of same name)
    const projectDirs = this.getProjectSkillsDirs(workspace);
    for (const pDir of projectDirs) {
      if (fs.existsSync(pDir)) {
        this.scanDirectoryForSkills(pDir, 'project', skillsMap, activeSkillsList);
      }
    }

    return Array.from(skillsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  private scanDirectoryForSkills(
    rootDir: string,
    source: 'project' | 'user',
    map: Map<string, Skill>,
    activeSkillsList: Set<string>
  ): void {
    if (!fs.existsSync(rootDir)) return;

    try {
      const entries = fs.readdirSync(rootDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillFolder = path.join(rootDir, entry.name);
        const skillMdPath = path.join(skillFolder, 'SKILL.md');

        if (fs.existsSync(skillMdPath)) {
          try {
            const raw = fs.readFileSync(skillMdPath, 'utf8');
            const { name, description, content } = this.parseSkillMd(raw, entry.name);

            // Discover optional references in references/ or resources/
            const references: string[] = [];
            const refsDir = path.join(skillFolder, 'references');
            if (fs.existsSync(refsDir)) {
              try {
                const refFiles = fs.readdirSync(refsDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
                for (const rf of refFiles) {
                  references.push(path.join(refsDir, rf));
                }
              } catch {
                // ignore
              }
            }

            const isExplicitlyActive = activeSkillsList.has(name);

            map.set(name, {
              name,
              description,
              path: skillFolder,
              source,
              enabled: isExplicitlyActive,
              content,
              references
            });
          } catch {
            // ignore corrupt skill file
          }
        }
      }
    } catch {
      // ignore
    }
  }

  public parseSkillMd(rawContent: string, defaultName: string): { name: string; description: string; content: string } {
    let name = defaultName;
    let description = '';
    let content = rawContent.trim();

    // Parse YAML frontmatter if present
    if (rawContent.startsWith('---')) {
      const endIdx = rawContent.indexOf('---', 3);
      if (endIdx !== -1) {
        const frontmatter = rawContent.slice(3, endIdx).trim();
        content = rawContent.slice(endIdx + 3).trim();

        const lines = frontmatter.split('\n');
        for (const line of lines) {
          const colonIdx = line.indexOf(':');
          if (colonIdx !== -1) {
            const key = line.slice(0, colonIdx).trim().toLowerCase();
            const val = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
            if (key === 'name' && val) name = val;
            if (key === 'description' && val) description = val;
          }
        }
      }
    }

    if (!description) {
      // Derive short description from first paragraph
      const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#'));
      description = firstLine ? firstLine.slice(0, 100) : 'Custom skill instructions';
    }

    return { name, description, content };
  }

  public getSkill(name: string, workspace = process.cwd()): Skill | null {
    const all = this.listSkills(workspace);
    return all.find(s => s.name.toLowerCase() === name.toLowerCase()) || null;
  }

  public enableSkill(name: string): boolean {
    const config = loadConfig();
    const skills = new Set(config.activeSkills || []);
    skills.add(name);
    config.activeSkills = Array.from(skills);
    saveConfig(config);
    return true;
  }

  public disableSkill(name: string): boolean {
    const config = loadConfig();
    const skills = new Set(config.activeSkills || []);
    const removed = skills.delete(name);
    config.activeSkills = Array.from(skills);
    saveConfig(config);
    return removed;
  }

  public addSkillFromPath(sourcePath: string): { success: boolean; skillName?: string; error?: string } {
    const resolved = path.resolve(sourcePath);
    if (!fs.existsSync(resolved)) {
      return { success: false, error: `Path does not exist: ${sourcePath}` };
    }

    const stat = fs.statSync(resolved);
    let targetSkillDir = '';
    let skillName = '';

    if (stat.isDirectory()) {
      const skillMd = path.join(resolved, 'SKILL.md');
      if (!fs.existsSync(skillMd)) {
        return { success: false, error: `No SKILL.md found in directory: ${sourcePath}` };
      }
      const raw = fs.readFileSync(skillMd, 'utf8');
      const parsed = this.parseSkillMd(raw, path.basename(resolved));
      skillName = parsed.name;
      targetSkillDir = path.join(this.userSkillsDir, skillName);

      // Copy directory safely (never executing scripts)
      fs.cpSync(resolved, targetSkillDir, { recursive: true });
    } else if (stat.isFile() && path.basename(resolved).toLowerCase().endsWith('.md')) {
      const raw = fs.readFileSync(resolved, 'utf8');
      skillName = path.basename(resolved, path.extname(resolved));
      const parsed = this.parseSkillMd(raw, skillName);
      skillName = parsed.name;
      targetSkillDir = path.join(this.userSkillsDir, skillName);

      if (!fs.existsSync(targetSkillDir)) {
        fs.mkdirSync(targetSkillDir, { recursive: true });
      }
      fs.writeFileSync(path.join(targetSkillDir, 'SKILL.md'), raw, 'utf8');
    } else {
      return { success: false, error: 'Source must be a skill folder with SKILL.md or a markdown file.' };
    }

    // Auto-enable newly added skill
    this.enableSkill(skillName);

    return { success: true, skillName };
  }

  public addSkillFromGit(repoUrl: string): { success: boolean; skillName?: string; error?: string } {
    try {
      const tempCloneDir = path.join(this.userSkillsDir, `_temp_${Date.now()}`);
      execSync(`git clone --depth 1 "${repoUrl}" "${tempCloneDir}"`, { stdio: 'pipe' });

      const res = this.addSkillFromPath(tempCloneDir);
      try {
        fs.rmSync(tempCloneDir, { recursive: true, force: true });
      } catch {
        // ignore
      }

      return res;
    } catch (err: any) {
      return { success: false, error: `Git clone failed: ${err.message}` };
    }
  }

  public removeSkill(name: string): boolean {
    this.disableSkill(name);
    const targetDir = path.join(this.userSkillsDir, name);
    if (fs.existsSync(targetDir)) {
      try {
        fs.rmSync(targetDir, { recursive: true, force: true });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Matches prompt against available skills by keyword and intent.
   * Transparent and non-intrusive.
   */
  public matchSkillsForPrompt(userPrompt: string, workspace = process.cwd()): Skill[] {
    const allSkills = this.listSkills(workspace);
    const matched: Skill[] = [];
    const promptLower = userPrompt.toLowerCase();

    for (const skill of allSkills) {
      // 1. If explicitly enabled in config, it's always included
      if (skill.enabled) {
        matched.push(skill);
        continue;
      }

      // 2. Keyword check against skill name and description
      const skillName = skill.name.toLowerCase();
      const descWords = skill.description.toLowerCase().split(/\W+/).filter(w => w.length > 3);

      if (promptLower.includes(skillName)) {
        matched.push(skill);
        continue;
      }

      let matchCount = 0;
      for (const word of descWords) {
        if (promptLower.includes(word)) {
          matchCount++;
        }
      }

      if (matchCount >= 2) {
        matched.push(skill);
      }
    }

    return matched;
  }
}
