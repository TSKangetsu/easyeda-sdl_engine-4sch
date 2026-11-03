import { LcedaBridge } from '../src/bridge/lceda-bridge.js';
import { SchCompiler } from '../src/compiler/sch-compiler.js';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('=== Declarative Schematic Generation: PWMBreakOut ===');

  const bridge = new LcedaBridge();
  const session = await bridge.getActiveSession();
  console.log(`Connected to session: [${session.sessionId}] "${session.title}"`);

  // Activate schematic page and clean any non-sheet components/wires
  await bridge.invoke(session.sessionId, `
    const proj = await eda.dmt_Project.getCurrentProjectInfo();
    const schPage = proj?.data?.[0]?.schematic?.page?.[0];
    if (schPage) {
      await eda.dmt_EditorControl.openDocument(schPage.uuid);
      await eda.dmt_EditorControl.activateDocument(schPage.uuid);
      await new Promise(r => setTimeout(r, 400));
    }

    const allComps = await eda.sch_PrimitiveComponent.getAll();
    const toDelComps = [];
    for (const c of allComps) {
      const cType = c.getState_ComponentType ? c.getState_ComponentType() : '';
      if (cType !== 'sheet') {
        toDelComps.push(c.getState_PrimitiveId());
      }
    }
    if (toDelComps.length > 0) {
      await eda.sch_PrimitiveComponent.delete(toDelComps);
    }

    const allWires = await eda.sch_PrimitiveWire.getAll();
    const toDelWires = allWires.map(w => w.getState_PrimitiveId());
    if (toDelWires.length > 0) {
      await eda.sch_PrimitiveWire.delete(toDelWires);
    }
  `);

  // Build Servo 3x10P rails declaratively
  // Footprint HDR-TH-30P-P2.54-V-F-R3-C10-S5.08 physical mapping:
  // For each column k = 0..9 (corresponding to FBW_PWM0 .. FBW_PWM9):
  // - Signal row (Pin 1 outer row): pin (3*k + 1) -> FBW_PWM{k}
  // - Middle row (Power rail):      pin (3*k + 2) -> VIN
  // - Other outer row (Ground):     pin (3*k + 3) -> GND
  const servoRails = [];
  for (let k = 0; k < 10; k++) {
    const sigPin = String(3 * k + 1);
    const vinPin = String(3 * k + 2);
    const gndPin = String(3 * k + 3);
    const isLeft = k < 5;
    const dir = isLeft ? 'left' : 'right';

    // 1. Signal pin (Inner column: length 35)
    servoRails.push({
      name: `SERVO_PWM${k}_RAIL`,
      from: { comp: 'SERVO1', pin: sigPin },
      direction: dir,
      length: 35,
      port: { portType: 'IN', net: `FBW_PWM${k}`, direction: dir }
    });

    // 2. Middle row VIN pin (Middle column: 27 units of clearance below upper GND wire, upward Power flag)
    servoRails.push({
      name: `SERVO_VIN_${k}_RAIL`,
      from: { comp: 'SERVO1', pin: vinPin },
      direction: dir,
      jog: isLeft ? { dx: -145, dy: -7 } : { dx: 145, dy: -17 },
      length: 15,
      flag: { type: 'Power', net: 'VIN', rotation: 0 }
    });

    // 3. Outer row GND pin (Outer column: straight horizontal wire to outermost column, outward Ground flag)
    servoRails.push({
      name: `SERVO_GND_${k}_RAIL`,
      from: { comp: 'SERVO1', pin: gndPin },
      direction: dir,
      length: 215,
      flag: { type: 'Ground', net: 'GND', rotation: isLeft ? 90 : 270 }
    });
  }

  const circuitSpec = {
    name: 'PWMBreakOut_Schematic',
    renderRegion: { minX: 40, minY: 60, maxX: 1120, maxY: 740 },
    renderWidth: 2000,
    modules: [
      // Module 1: ESC1 8P 1.0mm Connector (SM08B-SRSS-TB(LF)(SN), C160407)
      {
        name: 'ESC1_Input_Stage',
        origin: { x: 180, y: 600 },
        primaryComponents: [
          {
            id: 'ESC1',
            lcsc: 'C160407',
            keyword: 'SM08B-SRSS-TB(LF)(SN)',
            name: 'SM08B-SRSS-TB(LF)(SN)',
            offset: { x: 0, y: 0 },
            rotation: 180,
            labelOffsets: {
              designator: { dx: 25, dy: 0 },
              name: { dx: 20, dy: 0 }
            }
          }
        ],
        rails: [
          {
            name: 'ESC1_PWM0',
            from: { comp: 'ESC1', pin: '1' },
            direction: 'right',
            length: 55,
            port: { portType: 'OUT', net: 'FBW_PWM0', direction: 'right' }
          },
          {
            name: 'ESC1_PWM1',
            from: { comp: 'ESC1', pin: '2' },
            direction: 'right',
            length: 55,
            port: { portType: 'OUT', net: 'FBW_PWM1', direction: 'right' }
          },
          {
            name: 'ESC1_PWM2',
            from: { comp: 'ESC1', pin: '3' },
            direction: 'right',
            length: 55,
            port: { portType: 'OUT', net: 'FBW_PWM2', direction: 'right' }
          },
          {
            name: 'ESC1_PWM3',
            from: { comp: 'ESC1', pin: '4' },
            direction: 'right',
            length: 55,
            port: { portType: 'OUT', net: 'FBW_PWM3', direction: 'right' }
          },
          {
            name: 'ESC1_GND_PIN7',
            from: { comp: 'ESC1', pin: '7' },
            direction: 'right',
            length: 60,
            flag: { type: 'Ground', net: 'GND', rotation: 270 }
          },
          {
            name: 'ESC1_VIN_PIN8',
            from: { comp: 'ESC1', pin: '8' },
            direction: 'right',
            jog: { dx: 45, dy: 20 },
            flag: { type: 'Power', net: 'VIN', rotation: 0 }
          },
          {
            name: 'ESC1_SHIELD_PIN9',
            from: { comp: 'ESC1', pin: '9' },
            direction: 'down',
            jog: { dx: -35, dy: 15, preferVertical: true },
            length: 25,
            flag: { type: 'Ground', net: 'GND', rotation: 0 }
          }
        ],
        groundPins: [
          { comp: 'ESC1', pin: '10', direction: 'down', stubLength: 25, rotation: 0 }
        ],
        ncPins: [
          { comp: 'ESC1', pin: '5' },
          { comp: 'ESC1', pin: '6' }
        ]
      },

      // Module 2: SPI2 6P 1.0mm Connector (1.0-6P WT, C2906272)
      {
        name: 'SPI2_Input_Stage',
        origin: { x: 180, y: 380 },
        primaryComponents: [
          {
            id: 'SPI2',
            lcsc: 'C2906272',
            keyword: '1.0-6P WT',
            name: '1.0-6P WT',
            offset: { x: 0, y: 0 },
            rotation: 180,
            labelOffsets: {
              designator: { dx: 20, dy: 0 },
              name: { dx: 15, dy: 0 }
            }
          }
        ],
        rails: [
          {
            name: 'SPI2_PWM4',
            from: { comp: 'SPI2', pin: '1' },
            direction: 'right',
            length: 55,
            port: { portType: 'OUT', net: 'FBW_PWM4', direction: 'right' }
          },
          {
            name: 'SPI2_PWM5',
            from: { comp: 'SPI2', pin: '2' },
            direction: 'right',
            length: 55,
            port: { portType: 'OUT', net: 'FBW_PWM5', direction: 'right' }
          },
          {
            name: 'SPI2_PWM6',
            from: { comp: 'SPI2', pin: '3' },
            direction: 'right',
            length: 55,
            port: { portType: 'OUT', net: 'FBW_PWM6', direction: 'right' }
          },
          {
            name: 'SPI2_PWM7',
            from: { comp: 'SPI2', pin: '4' },
            direction: 'right',
            length: 55,
            port: { portType: 'OUT', net: 'FBW_PWM7', direction: 'right' }
          },
          {
            name: 'SPI2_PWM8',
            from: { comp: 'SPI2', pin: '5' },
            direction: 'right',
            length: 55,
            port: { portType: 'OUT', net: 'FBW_PWM8', direction: 'right' }
          },
          {
            name: 'SPI2_PWM9',
            from: { comp: 'SPI2', pin: '6' },
            direction: 'right',
            length: 55,
            port: { portType: 'OUT', net: 'FBW_PWM9', direction: 'right' }
          },
          {
            name: 'SPI2_SHIELD_PIN7',
            from: { comp: 'SPI2', pin: '7' },
            direction: 'down',
            jog: { dx: -35, dy: 15, preferVertical: true },
            length: 25,
            flag: { type: 'Ground', net: 'GND', rotation: 0 }
          }
        ],
        groundPins: [
          { comp: 'SPI2', pin: '8', direction: 'down', stubLength: 25, rotation: 0 }
        ]
      },

      // Module 3: XT60 Horizontal Male Power Input (XT60PW-M, C98732)
      // Note: C428721 is XT30UPB-M (vertical 15A); C98732 is the exact horizontal male XT60 (XT60PW-M, datasheet C428722).
      {
        name: 'XT60_Power_Stage',
        origin: { x: 200, y: 170 },
        primaryComponents: [
          {
            id: 'XT60',
            lcsc: 'C98732',
            keyword: 'XT60PW-M',
            name: 'XT60PW-M',
            comment: 'XT60PW-M (公头)',
            offset: { x: 0, y: 0 },
            rotation: 0,
            labelOffsets: {
              designator: { dx: 15, dy: 5 },
              name: { dx: 15, dy: 0 }
            }
          }
        ],
        rails: [
          {
            name: 'XT60_VIN_RAIL',
            from: { comp: 'XT60', pin: '2' },
            direction: 'left',
            jog: { dx: -45, dy: 30 },
            flag: { type: 'Power', net: 'VIN', rotation: 0 }
          },
          {
            name: 'XT60_GND_RAIL',
            from: { comp: 'XT60', pin: '1' },
            direction: 'left',
            jog: { dx: -25, dy: -30 },
            flag: { type: 'Ground', net: 'GND', rotation: 0 }
          }
        ],
        ncPins: [
          { comp: 'XT60', pin: '3' },
          { comp: 'XT60', pin: '4' }
        ]
      },

      // Module 4: 3X10P Servo Output Header (KH-2.54PH180-3X10P-L11.5, C20610257)
      {
        name: 'Servo_Header_Stage',
        origin: { x: 760, y: 480 },
        primaryComponents: [
          {
            id: 'SERVO1',
            lcsc: 'C20610257',
            keyword: 'KH-2.54PH180-3X10P-L11.5',
            name: 'KH-2.54PH180-3X10P-L11.5',
            offset: { x: 0, y: 0 },
            rotation: 0
          }
        ],
        rails: servoRails
      }
    ]
  };

  console.log('Compiling circuitSpec via SchCompiler...');
  const compiledJs = SchCompiler.compileToJs(circuitSpec);

  console.log('Executing in EasyEDA Pro session...');
  const t0 = Date.now();
  const res = await bridge.invoke(session.sessionId, compiledJs);
  const t1 = Date.now();

  if (!res.ok || !res.value?.ok) {
    console.error('Execution failed:', res.value?.error || res.error);
    if (res.value?.stack) console.error(res.value.stack);
    process.exit(1);
  }

  const r = res.value.results;
  console.log(`Generated in ${t1 - t0}ms:`);
  console.log(`- Components (${Object.keys(r.components).length}):`, Object.keys(r.components).join(', '));
  console.log(`- Wires: ${r.wires.length}`);
  console.log(`- Flags: ${r.flags.length}`);
  console.log(`- Ports: ${r.ports.length}`);

  if (r.screenshotBase64) {
    const out1 = path.resolve('test/pwm-breakout-schematic.png');
    const out2 = path.resolve('test/output-schematic.png');
    const buf = Buffer.from(r.screenshotBase64, 'base64');
    fs.writeFileSync(out1, buf);
    fs.writeFileSync(out2, buf);
    console.log(`Saved screenshot to ${out1}`);
  } else if (r.renderError) {
    console.warn('Render warning:', r.renderError);
  }

  // Run DRC & Component/Net verification
  const verifyRes = await bridge.invoke(session.sessionId, `
    const drcPassed = await eda.sch_Drc.check(false, false);
    const allNets = await eda.sch_Net.getAllNetsName();
    const comps = await eda.sch_PrimitiveComponent.getAll();
    const parts = comps
      .filter(c => c.getState_ComponentType && c.getState_ComponentType() === 'part')
      .map(c => ({
        designator: c.getState_Designator(),
        name: c.getState_Name(),
        addIntoBom: c.getState_AddIntoBom(),
        addIntoPcb: c.getState_AddIntoPcb()
      }));
    return { drcPassed, allNets, parts };
  `);
  console.log('Verification:', JSON.stringify(verifyRes.value, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
