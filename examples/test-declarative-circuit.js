import { LcedaBridge } from '../src/bridge/lceda-bridge.js';
import { SchCompiler } from '../src/compiler/sch-compiler.js';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('=== Declarative Schematic Generation Test (Corrected Geometry) ===');

  const bridge = new LcedaBridge();
  const session = await bridge.getActiveSession();
  console.log(`Connected to session: [${session.sessionId}] "${session.title}"`);

  // Clean up any test components in the test region
  console.log('Cleaning up previous test primitives...');
  await bridge.invoke(session.sessionId, `
    // Delete any components in the 3100..3900, 2700..3200 box
    const allComps = await eda.sch_PrimitiveComponent.getAll();
    const toDeleteComps = [];
    for (const c of allComps) {
      const x = c.getState_X ? c.getState_X() : 0;
      const y = c.getState_Y ? c.getState_Y() : 0;
      if (x >= 3100 && x <= 3900 && y >= 2700 && y <= 3200) {
        toDeleteComps.push(c.getState_PrimitiveId());
      }
    }
    if (toDeleteComps.length > 0) {
      await eda.sch_PrimitiveComponent.delete(toDeleteComps);
    }

    const allWires = await eda.sch_PrimitiveWire.getAll();
    const toDeleteWires = [];
    for (const w of allWires) {
      const line = w.getState_Line ? w.getState_Line() : [];
      const flat = line.flat ? line.flat() : [];
      if (flat.length >= 2 && flat[0] >= 3100 && flat[0] <= 3900 && flat[1] >= 2700 && flat[1] <= 3200) {
        toDeleteWires.push(w.getState_PrimitiveId());
      }
    }
    if (toDeleteWires.length > 0) {
      await eda.sch_PrimitiveWire.delete(toDeleteWires);
    }
    return { deletedComps: toDeleteComps.length, deletedWires: toDeleteWires.length };
  `);

  // Declarative Circuit Spec with Correct Geometry & Orientation
  // EasyEDA Schematic: +X is RIGHT, -X is LEFT, +Y is UP, -Y is DOWN.
  const circuitSpec = {
    name: 'PowerStage_AMS1117',
    modules: [
      {
        name: 'LDO_3V3_Module',
        origin: { x: 3500, y: 3000 },
        primaryComponents: [
          {
            id: 'U1',
            keyword: 'AMS1117',
            name: 'AMS1117-3.3',
            offset: { x: 0, y: 0 }
          }
        ],
        // Internal jumpers / ties
        ties: [
          // Pin 4 (TAB) is at (3540, 3000), Pin 2 (VOUT) is at (3540, 3010)
          { from: { comp: 'U1', pin: '4' }, to: { comp: 'U1', pin: '2' }, net: 'VCC_3V3' }
        ],
        // Power rails extending outward with bypass capacitor branches
        rails: [
          // Input Rail: extends LEFT (-X) from Pin 3 (VIN)
          {
            name: 'VIN_RAIL',
            from: { comp: 'U1', pin: '3' },
            direction: 'left',
            length: 220,
            net: 'VCC_5V',
            flag: { type: 'Power', net: 'VCC_5V', rotation: 0 },
            branches: [
              {
                atDistance: 110, // x = 3460 - 110 = 3350
                component: { id: 'C1', keyword: 'Capacitor', value: '10uF', rotation: 90 },
                branchLength: 40, // Top pin at y = 3000 - 40 = 2960
                groundStub: 30    // Bottom pin at y = 2920, GND flag at y = 2890
              }
            ]
          },
          // Output Rail: extends RIGHT (+X) from Pin 2 (VOUT)
          {
            name: 'VOUT_RAIL',
            from: { comp: 'U1', pin: '2' },
            direction: 'right',
            length: 220,
            net: 'VCC_3V3',
            flag: { type: 'Power', net: 'VCC_3V3', rotation: 0 },
            branches: [
              {
                atDistance: 110, // x = 3540 + 110 = 3650
                component: { id: 'C2', keyword: 'Capacitor', value: '22uF', rotation: 90 },
                branchLength: 50, // Top pin at y = 3010 - 50 = 2960
                groundStub: 30    // Bottom pin at y = 2920, GND flag at y = 2890
              }
            ]
          }
        ],
        // Ground pins on primary chip
        groundPins: [
          { comp: 'U1', pin: '1', stubLength: 45 } // Extends straight down (-Y)
        ]
      }
    ]
  };

  console.log('\n--- Compiling Declarative Spec ---');
  const compiledJs = SchCompiler.compileToJs(circuitSpec);

  console.log('\n--- Executing in EasyEDA Session ---');
  const execResult = await bridge.invoke(session.sessionId, compiledJs);

  if (!execResult.ok || !execResult.value?.ok) {
    console.error('\n❌ FAILED:', execResult.value?.error || execResult.error);
    if (execResult.value?.stack) console.error(execResult.value.stack);
    process.exit(1);
  }

  const r = execResult.value.results;
  console.log('\n SUCCESS: Circuit generated with verified geometry!');
  console.log(`- Components (${Object.keys(r.components).length}):`, Object.keys(r.components).join(', '));
  console.log(`- Wires (${r.wires.length}):`, r.wires.map(w => `${w.from} -> ${w.to}`).join(' | '));
  console.log(`- Net Flags (${r.flags.length}):`, r.flags.map(f => `${f.type}:${f.net}`).join(', '));

  // If screenshot was captured, save it to disk
  if (r.screenshotBase64) {
    const imgPath = path.resolve('test/output-schematic.png');
    fs.writeFileSync(imgPath, Buffer.from(r.screenshotBase64, 'base64'));
    console.log(`\n📸 Captured canvas screenshot saved to: ${imgPath}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
