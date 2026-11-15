/// <reference types="node" />
// The licence notices that ship with the website (public/licences/THIRD-PARTY-NOTICES.txt):
// present, complete for what the code imports, and up to date with the installed packages.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importedPackages, NOTICES_FILE, packageName, renderNotices, ROOT, shippedPackages } from '../scripts/build-licences.mjs';

const notices = () => readFileSync(join(ROOT, NOTICES_FILE), 'utf8');

describe('third-party licence notices', () => {
  it('ships in public/, which Vite copies into the build unchanged', () => {
    expect(NOTICES_FILE).toBe('public/licences/THIRD-PARTY-NOTICES.txt');
    // Nothing moves or turns off Vite's public directory, so the file reaches dist/licences/.
    expect(readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')).not.toMatch(/publicDir/);
    expect(notices().length).toBeGreaterThan(1000);
  });

  it('is up to date with the installed packages (else run: node scripts/build-licences.mjs)', () => {
    expect(notices()).toBe(renderNotices());
  });

  it('covers every package the website code imports, with version, licence and text', () => {
    const { app, tools } = shippedPackages();
    const listed = app.map((p) => p.name);
    for (const name of importedPackages()) expect(listed).toContain(name);
    for (const name of ['three', 'astronomy-engine', '@fontsource-variable/inter', '@fontsource-variable/space-grotesk']) expect(listed).toContain(name);
    expect(tools.map((p) => p.name)).toEqual(['vite', 'rolldown']);
    const text = notices();
    for (const p of [...app, ...tools]) {
      expect(p.texts.length, p.name).toBeGreaterThan(0);
      expect(text).toContain(`${p.name} ${p.version}\nLicence: ${p.licence}\n`);
    }
  });

  it('carries the licence texts themselves: MIT for three.js and astronomy-engine, the OFL for both fonts', () => {
    const { app } = shippedPackages();
    const textOf = (name: string) => app.find((p) => p.name === name)!.texts.map((t) => t.text).join('\n');
    expect(textOf('three')).toMatch(/The MIT License[\s\S]*Copyright © 2010-\d{4} three\.js authors/);
    expect(textOf('astronomy-engine')).toMatch(/MIT License[\s\S]*Copyright \(c\) 2019-\d{4} Don Cross/);
    for (const font of ['@fontsource-variable/inter', '@fontsource-variable/space-grotesk']) {
      expect(textOf(font)).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
      expect(textOf(font)).toMatch(/Copyright \d{4}/);
    }
    // Vite's own licence only: the licences of the packages bundled into Vite are not about this website.
    const vite = shippedPackages().tools.find((p) => p.name === 'vite')!.texts[0].text;
    expect(vite).toMatch(/Vite core license[\s\S]*MIT License/);
    expect(vite).not.toMatch(/Licenses of bundled dependencies/);
  });

  it('reads package names from import specifiers', () => {
    expect(packageName('three/examples/jsm/controls/OrbitControls.js')).toBe('three');
    expect(packageName('@fontsource-variable/inter')).toBe('@fontsource-variable/inter');
    expect(packageName('@scope/pkg/sub/path.js')).toBe('@scope/pkg');
    for (const local of ['./x', '../y.ts', '/abs.js', 'node:fs', 'virtual:z']) expect(packageName(local)).toBeNull();
  });
});
