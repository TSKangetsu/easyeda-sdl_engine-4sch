import { LcedaBridge } from '../src/bridge/lceda-bridge.js';
import { SchCompiler } from '../src/compiler/sch-compiler.js';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('=== Declarative Schematic Generation: MP9943 Buck Converter ===');

  const bridge = new LcedaBridge();
  const session = await bridge.getActiveSession();
  console.log(`Connected to session: [${session.sessionId}] "${session.title}"`);

  // Switch to schematic page
  await bridge.invoke(session.sessionId, `
    const proj = await eda.dmt_Project.getCurrentProjectInfo();
    const schPage = proj?.data?.[0]?.schematic?.page?.[0];
    if (schPage) {
      await eda.dmt_EditorControl.openDocument(schPage.uuid);
      await eda.dmt_EditorControl.activateDocument(schPage.uuid);
      await new Promise(r => setTimeout(r, 400));
    }
  `);

  // Clean up previous primitives in the target region (x: 2500..3700, y: 1200..1900)
  console.log('Cleaning target region (x: 2500..3700, y: 1200..1900)...');
  await bridge.invoke(session.sessionId, `
    const allComps = await eda.sch_PrimitiveComponent.getAll();
    const toDelComps = [];
    for (const c of allComps) {
      const x = c.getState_X ? c.getState_X() : 0;
      const y = c.getState_Y ? c.getState_Y() : 0;
      if (x >= 2500 && x <= 3700 && y >= 1200 && y <= 1900) {
        toDelComps.push(c.getState_PrimitiveId());
      }
    }
    if (toDelComps.length > 0) {
      await eda.sch_PrimitiveComponent.delete(toDelComps);
    }

    const allWires = await eda.sch_PrimitiveWire.getAll();
    const toDelWires = [];
    for (const w of allWires) {
      const line = w.getState_Line ? w.getState_Line() : [];
      const flat = line.flat ? line.flat() : [];
      if (flat.length >= 2 && flat[0] >= 2500 && flat[0] <= 3700 && flat[1] >= 1200 && flat[1] <= 1900) {
        toDelWires.push(w.getState_PrimitiveId());
      }
    }
    if (toDelWires.length > 0) {
      await eda.sch_PrimitiveWire.delete(toDelWires);
    }

    return { deletedComps: toDelComps.length, deletedWires: toDelWires.length };
  `);

  console.log('Building 100% Declarative Circuit Specification...');

  /**
   * 100% Declarative Circuit Specification for MP9943 Buck Converter
   *
   * Pin Layout of U8 (MP9943GQ-Z) at origin (3000, 1600):
   * - Left:
   *   Pin 1 (FB):      dx=-50, dy=+15 (2950, 1615) -> Jog up to y=1665 -> Series V1 (51k) -> NetPort 'FB_DIV'
   *   Pin 2 (VCC):     dx=-50, dy=+5  (2950, 1605) -> Straight at y=1605 -> Series Decoupling CV1 (10uF) -> Ground Flag
   *   Pin 3 (EN/SYNC): dx=-50, dy=-5  (2950, 1595) -> Jog down to y=1555 -> Series V5 (1M) -> Power Flag 'VIN'
   *   Pin 4 (BST):     dx=-50, dy=-15 (2950, 1585) -> Jog down to y=1495 -> Series V6 (20Ω) -> Series CV2 (100nF) -> NetPort 'SW'
   * - Right:
   *   Pin 8 (PG):      dx=+50, dy=+15 (3050, 1615) -> NetPort 'PG'
   *   Pin 7 (IN):      dx=+50, dy=+5  (3050, 1605) -> Jog up (dx:30, dy:80) -> VIN rail + parallel CV4(22uF), CV3(100nF)
   *   Pin 6 (SW):      dx=+50, dy=-5  (3050, 1595) -> Jog down (dx:40, dy:-90) -> SW port -> Series LV1(10uH) -> 5V rail + CV5, CV6 + Feedback Divider (V2/V3)
   *   Pin 5 (GND):     dx=+50, dy=-15 (3050, 1585) -> Ground stub right -> GND Flag
   */
  const circuitSpec = {
    name: 'MP9943_Buck_Converter',
    renderRegion: { minX: 2550, minY: 1200, maxX: 3600, maxY: 1800 },
    renderWidth: 1600,
    modules: [
      {
        name: 'MP9943_Power_Stage',
        origin: { x: 3000, y: 1600 },
        primaryComponents: [
          {
            id: 'U8',
            keyword: 'MP9943GQ-Z',
            name: 'MP9943GQ-Z',
            offset: { x: 0, y: 0 },
            rotation: 0
          }
        ],
        rails: [
          // 1. Right Side: Pin 7 (IN) -> Jog right & up past PG port to y=1710 -> VIN Rail with parallel bypass caps CV4 and CV3
          {
            name: 'VIN_INPUT_RAIL',
            from: { comp: 'U8', pin: '7' },
            direction: 'right',
            jog: { dx: 140, dy: 105 },
            length: 220,
            flag: { type: 'Power', net: 'VIN', rotation: 0 },
            branches: [
              {
                atDistance: 60,
                component: { id: 'CV4', keyword: 'CL10A', value: '22uF', rotation: 90 },
                branchLength: 50,
                groundStub: 25
              },
              {
                atDistance: 140,
                component: { id: 'CV3', keyword: 'CL10A', value: '100nF', rotation: 90 },
                branchLength: 50,
                groundStub: 25
              }
            ]
          },

          // 2. Right Side: Pin 8 (PG) -> NetPort 'PG'
          {
            name: 'PG_RAIL',
            from: { comp: 'U8', pin: '8' },
            direction: 'right',
            length: 50,
            port: { portType: 'OUT', net: 'PG', rotation: 0 }
          },

          // 3. Right Side: Pin 6 (SW) -> Jog down to y=1500 -> SW tap -> Series Inductor LV1 (10uH) -> 5V Rail + CV5, CV6 + Feedback Divider
          {
            name: 'VOUT_5V_RAIL',
            from: { comp: 'U8', pin: '6' },
            direction: 'right',
            jog: { dx: 60, dy: -95 },
            series: [
              {
                component: { id: 'LV1', keyword: 'TMPA0402SP-100MN', value: '10uH', rotation: 0 },
                wireLength: 35,
                tapBefore: {
                  port: { portType: 'BI', net: 'SW', direction: 'left', stubLength: 40, rotation: 180 }
                }
              }
            ],
            length: 290,
            flag: { type: 'Power', net: '5V', rotation: 0 },
            branches: [
              {
                atDistance: 60,
                component: { id: 'CV5', keyword: 'CL10A', value: '22uF', rotation: 90 },
                branchLength: 50,
                groundStub: 25
              },
              {
                atDistance: 135,
                component: { id: 'CV6', keyword: 'CL10A', value: '22uF', rotation: 90 },
                branchLength: 50,
                groundStub: 25
              }
            ],
            divider: {
              atDistance: 215,
              topResistor: { id: 'V2', keyword: 'RT0603', value: '43kΩ', rotation: 90 },
              bottomResistor: { id: 'V3', keyword: 'RT0603', value: '7.5kΩ', rotation: 90 },
              branchLength: 45,
              dividerSpacing: 45,
              groundStub: 25,
              tapPort: { portType: 'OUT', net: 'FB_TAP', direction: 'right', stubLength: 35, rotation: 0 }
            }
          },

          // 4. Left Side: Pin 4 (BST) -> Jog down to y=1460 -> Series Resistor V6 (20Ω) -> Series Capacitor CV2 (100nF) -> NetPort 'SW'
          {
            name: 'BST_RAIL',
            from: { comp: 'U8', pin: '4' },
            direction: 'left',
            jog: { dx: -20, dy: -125 },
            series: [
              {
                component: { id: 'V6', keyword: 'RT0603', value: '20Ω', rotation: 0 },
                wireLength: 30
              },
              {
                component: { id: 'CV2', keyword: 'CL10A', value: '100nF', rotation: 0 },
                wireLength: 30
              }
            ],
            port: { portType: 'BI', net: 'SW', direction: 'left', stubLength: 60, rotation: 180 }
          },

          // 5. Left Side: Pin 3 (EN/SYNC) -> Jog down to y=1520 (above BST rail) -> Series Resistor V5 (1MΩ) -> Power Flag 'VIN'
          {
            name: 'EN_RAIL',
            from: { comp: 'U8', pin: '3' },
            direction: 'left',
            jog: { dx: -45, dy: -75 },
            series: [
              {
                component: { id: 'V5', keyword: 'RT0603', value: '1MΩ', rotation: 0 },
                wireLength: 30
              }
            ],
            flag: { type: 'Power', net: 'VIN', direction: 'left', stubLength: 30, rotation: 0 }
          },

          // 6. Left Side: Pin 2 (VCC) -> Straight along y=1605 -> Decoupling Capacitor CV1 (10uF) with clean downward Ground flag
          {
            name: 'VCC_RAIL',
            from: { comp: 'U8', pin: '2' },
            direction: 'left',
            series: [
              {
                component: { id: 'CV1', keyword: 'CL10A', value: '10uF', rotation: 0 },
                wireLength: 30
              }
            ],
            length: 40,
            flag: { type: 'Ground', net: 'GND', direction: 'down', stubLength: 25, rotation: 0 }
          },

          // 7. Left Side: Pin 1 (FB) -> Jog up to y=1690 -> Series Resistor V1 (51kΩ) -> NetPort 'FB_TAP'
          {
            name: 'FB_RAIL',
            from: { comp: 'U8', pin: '1' },
            direction: 'left',
            jog: { dx: -40, dy: 75 },
            series: [
              {
                component: { id: 'V1', keyword: 'RT0603', value: '51kΩ', rotation: 0 },
                wireLength: 30
              }
            ],
            port: { portType: 'IN', net: 'FB_TAP', direction: 'left', stubLength: 90, rotation: 0 }
          }
        ],

        // Direct Ground Pins: Pin 5 (GND) extends right to GND flag
        groundPins: [
          { comp: 'U8', pin: '5', direction: 'right', stubLength: 30, rotation: 270 }
        ]
      }
    ]
  };

  console.log('\n--- Compiling Declarative Spec to Executable JS ---');
  const compiledJs = SchCompiler.compileToJs(circuitSpec);

  console.log('\n--- Executing in EasyEDA Pro Session ---');
  const t0 = Date.now();
  const execResult = await bridge.invoke(session.sessionId, compiledJs);
  const t1 = Date.now();

  if (!execResult.ok || !execResult.value?.ok) {
    console.error('\n❌ FAILED:', execResult.value?.error || execResult.error);
    if (execResult.value?.stack) console.error(execResult.value.stack);
    process.exit(1);
  }

  const r = execResult.value.results;
  console.log(`\n SUCCESS: MP9943 Buck Converter schematic generated 100% declaratively in ${t1 - t0}ms!`);
  console.log(`- Components (${Object.keys(r.components).length}):`, Object.keys(r.components).join(', '));
  console.log(`- Wires (${r.wires.length}):`, r.wires.map(w => `${w.from} -> ${w.to}`).join(' | '));
  console.log(`- Net Flags (${r.flags.length}):`, r.flags.map(f => `${f.type}:${f.net}`).join(', '));
  console.log(`- Net Ports (${r.ports.length}):`, r.ports.map(p => `${p.type || 'Port'}:${p.net}`).join(', '));

  if (r.screenshotBase64) {
    const outImg = path.resolve('test/mp9943-generated-schematic.png');
    fs.writeFileSync(outImg, Buffer.from(r.screenshotBase64, 'base64'));
    console.log(`\n📸 Captured canvas screenshot saved to: ${outImg}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
