#!/usr/bin/env node
// bin/slopscore.mjs — Global CLI for Slopscore 2.0
// Commands: init, studio, build, audio, features, bank, sheet, render, inspect, validate, loop, mcp, doctor

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadProject } from '../kit/config-loader.mjs';
import { validateProject, RENDERERS } from '../kit/project-schema.js';
import { buildNative, synthesizeAudio, prepareRenderContext, renderSheet, renderVideo } from '../kit/render-pipeline.mjs';
import { buildAssetBank } from '../kit/asset-bank.mjs';
import { autoMatchFile } from '../kit/loop-finder.mjs';
import { scaffoldProject, executeMcpTool } from '../mcp/tools.mjs';

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        flags[a.slice(2)] = argv[++i];
      } else {
        flags[a.slice(2)] = true;
      }
    } else if (a.startsWith('-') && a.length === 2) {
      flags[a.slice(1)] = true;
    } else {
      positionals.push(a);
    }
  }
  return { cmd: positionals[0] || 'help', target: positionals[1] || null, positionals, flags };
}

function printHelp() {
  console.log(`
Slopscore 2.0 — Universal Procedural Audio-Visual Engine & Director Studio

Usage:
  slopscore <command> [project-dir] [options]

Commands:
  init <dir>         Scaffold a new Slopscore project (--template=default|willnever-reference)
  studio [dir]       Launch the interactive Director Studio Web UI (--port=8989)
  render [dir]       Render master or range video (--range=0:15 --out=out/video.mp4 --renderer=...)
  sheet [dir]        Render 12-keyframe contact sheet (--out=out/sheet.jpg --times=4,16,50...)
  audio [dir]        Synthesize score & extract features.bin (--stems --out=out/score.wav)
  features [dir]     Extract analytical energy curves into out/features.bin
  bank [dir]         Sample media clips into out/archive_bank.bin & out/bank.json
  build [dir]        Compile native Objective-C / CoreGraphics / Metal renderer
  loop [dir]         Run seamless A/B loop automatcher (--asset=file.webm --in=0 --out=4)
  inspect [dir]      Inspect project configuration, chapters, clips, and artifacts
  validate [dir]     Validate slopscore.config.js schema
  mcp                Start the stdio MCP server for external coding agents
  doctor             Check system toolchain (Node, clang, ffmpeg, cargo, Chrome)

Renderers (${RENDERERS.join(', ')}):
  Pass --renderer=<name> to sheet or render to override the project's default engine.
`.trim());
}

async function run() {
  const { cmd, target, flags } = parseArgs(process.argv.slice(2));
  const dir = target || flags.dir || process.cwd();

  switch (cmd) {
    case 'help':
    case '-h':
    case '--help':
      printHelp();
      return;

    case 'init': {
      const targetDir = target || flags.dir || './my-slopscore-project';
      const res = await scaffoldProject({
        dir: targetDir,
        template: flags.template || 'default',
        title: flags.title,
        renderer: flags.renderer,
        bpm: flags.bpm ? Number(flags.bpm) : undefined
      });
      console.log(`✓ Initialized Slopscore project at ${res.dir} (template: ${res.template})`);
      console.log(`  Config: ${res.configFile}`);
      console.log(`  Next steps:\n    slopscore studio ${targetDir}\n    slopscore sheet ${targetDir}\n    slopscore render ${targetDir}`);
      return;
    }

    case 'studio': {
      const { startStudioServer } = await import('../studio/server.mjs');
      const loaded = await loadProject(dir);
      const port = Number(flags.port || process.env.PORT || loaded.project.studio?.port || 8989);
      await startStudioServer({ root: loaded.root, port });
      return;
    }

    case 'build': {
      const loaded = await loadProject(dir);
      console.log(`[Slopscore] Compiling native renderer for ${loaded.project.title}...`);
      const bin = buildNative(loaded);
      console.log(`✓ Native renderer built: ${bin}`);
      return;
    }

    case 'audio': {
      const loaded = await loadProject(dir);
      console.log(`[Slopscore] Synthesizing ${loaded.project.audio.durationSeconds}s score @ ${loaded.project.audio.bpm} BPM...`);
      const res = await synthesizeAudio(loaded, {
        stems: Boolean(flags.stems),
        force: flags.force !== undefined ? Boolean(flags.force) : true,
        outPath: typeof flags.out === 'string' ? flags.out : null
      });
      console.log(`✓ Score written: ${res.scorePath}`);
      console.log(`✓ Features written: ${res.featuresPath}`);
      if (res.stems?.length) console.log(`✓ Stems exported (${res.stems.length}): ${loaded.paths.outStems}`);
      return;
    }

    case 'features': {
      const loaded = await loadProject(dir);
      await prepareRenderContext(loaded);
      console.log(`✓ Audio features & frame context written: ${loaded.paths.features}`);
      return;
    }

    case 'bank': {
      const loaded = await loadProject(dir);
      const manifest = await buildAssetBank(loaded, { force: Boolean(flags.force) });
      console.log(`✓ Asset bank written: ${loaded.paths.bank} (${manifest.totalFrames} frames across ${manifest.clips.length} clips)`);
      return;
    }

    case 'sheet': {
      const loaded = await loadProject(dir);
      const res = await renderSheet(loaded, {
        outPath: typeof flags.out === 'string' ? flags.out : null,
        times: typeof flags.times === 'string' ? flags.times : (typeof flags.sheet === 'string' ? flags.sheet : null),
        renderer: typeof flags.renderer === 'string' ? flags.renderer : null
      });
      console.log(`✓ Contact sheet rendered (${res.renderer}): ${res.outPath}`);
      return;
    }

    case 'render':
    case 'video': {
      const loaded = await loadProject(dir);
      if (flags['audio-only']) {
        const res = await synthesizeAudio(loaded, {
          stems: Boolean(flags.stems),
          outPath: typeof flags.out === 'string' ? flags.out : null
        });
        console.log(`✓ Audio rendered: ${res.scorePath}`);
        return;
      }
      if (flags.sheet) {
        const res = await renderSheet(loaded, {
          outPath: typeof flags.out === 'string' ? flags.out : null,
          times: typeof flags.sheet === 'string' ? flags.sheet : null,
          renderer: typeof flags.renderer === 'string' ? flags.renderer : null
        });
        console.log(`✓ Contact sheet rendered (${res.renderer}): ${res.outPath}`);
        return;
      }
      const res = await renderVideo(loaded, {
        outPath: typeof flags.out === 'string' ? flags.out : null,
        range: typeof flags.range === 'string' ? flags.range : null,
        renderer: typeof flags.renderer === 'string' ? flags.renderer : null
      });
      console.log(`✓ Video rendered (${res.renderer}, ${res.frames} frames / ${res.duration.toFixed(1)}s): ${res.outPath}`);
      return;
    }

    case 'loop': {
      const loaded = await loadProject(dir);
      const asset = flags.asset || positionals[2];
      if (!asset) throw new Error('Pass --asset=<filename> to slopscore loop');
      const assetPath = path.isAbsolute(asset)
        ? asset
        : fs.existsSync(path.join(loaded.paths.assets, asset))
          ? path.join(loaded.paths.assets, asset)
          : path.resolve(loaded.root, asset);
      const res = await autoMatchFile(assetPath, {
        inSec: flags.in != null ? Number(flags.in) : 0,
        outSec: flags.out != null ? Number(flags.out) : 3,
        window: flags.window != null ? Number(flags.window) : 1.5
      });
      console.log(JSON.stringify(res, null, 2));
      return;
    }

    case 'inspect': {
      const info = await executeMcpTool('slopscore_inspect', { dir });
      console.log(JSON.stringify(info, null, 2));
      return;
    }

    case 'validate': {
      const loaded = await loadProject(dir);
      const v = validateProject(loaded.project);
      console.log(JSON.stringify({ root: loaded.root, ...v }, null, 2));
      if (!v.ok) process.exit(1);
      return;
    }

    case 'mcp': {
      await import('../mcp/server.mjs');
      return;
    }

    case 'doctor': {
      const checks = [
        ['node', process.version],
        ['clang', spawnSync('clang', ['--version'], { encoding: 'utf8' }).stdout?.split('\n')[0] || 'missing'],
        ['ffmpeg', spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).stdout?.split('\n')[0] || 'missing'],
        ['cargo', spawnSync('cargo', ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'missing'],
        ['chrome', fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? 'installed' : 'missing']
      ];
      for (const [k, v] of checks) console.log(`  ${k.padEnd(10)}: ${v}`);
      return;
    }

    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

run().catch(err => {
  console.error(`[Slopscore Error] ${err.message}`);
  process.exit(1);
});
