/**
 * Declarative Schematic Compiler for EasyEDA Pro
 * Compiles high-level component declarations into EasyEDA execution runtime
 * 
 * Coordinate System:
 * - EasyEDA Schematic: +X is RIGHT, -X is LEFT, +Y is UP, -Y is DOWN.
 */

export class SchCompiler {
  /**
   * Build executable JavaScript source code to execute inside EasyEDA editor
   * @param {Object} circuitSpec High-level declarative circuit spec
   * @returns {string} JavaScript code to pass to lceda-pro invoke
   */
  static compileToJs(circuitSpec) {
    const serializedSpec = JSON.stringify(circuitSpec);

    return `
      const spec = ${serializedSpec};
      const results = {
        components: {},
        wires: [],
        flags: [],
        ports: [],
        errors: [],
        screenshotBase64: null
      };

      const createdWireIds = [];
      const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      function updateBounds(x, y, radius = 40) {
        if (typeof x === 'number' && typeof y === 'number' && !isNaN(x) && !isNaN(y)) {
          if (x - radius < bounds.minX) bounds.minX = x - radius;
          if (x + radius > bounds.maxX) bounds.maxX = x + radius;
          if (y - radius < bounds.minY) bounds.minY = y - radius;
          if (y + radius > bounds.maxY) bounds.maxY = y + radius;
        }
      }

      // Auto-dismiss watcher for #noticeCompVUpdatedDlg ("工程库存在其他版本，请选择你需要进行的操作")
      let dialogWatcherId = null;
      if (typeof globalThis.document !== 'undefined') {
        dialogWatcherId = setInterval(() => {
          try {
            const doc = globalThis.document;
            const dlg = doc.getElementById('noticeCompVUpdatedDlg') ||
              Array.from(doc.querySelectorAll('div')).find(d => d.innerText && d.innerText.includes('工程库存在其他版本'));
            if (dlg) {
              const r1 = dlg.querySelector('input[type="radio"][value="1"]');
              if (r1 && !r1.checked) {
                r1.checked = true;
                r1.dispatchEvent(new Event('change', { bubbles: true }));
              }
              const btn = dlg.querySelector('button[data-test="Confirm"], button[title="确认"], button[title="确定"], .el-button--primary') ||
                Array.from(dlg.querySelectorAll('button')).find(b => b.innerText && (b.innerText.includes('确') || b.innerText.includes('OK')));
              if (btn) btn.click();
            }
          } catch(e) {}
        }, 50);
      }

      try {
        // Ensure schematic document is open & active before executing schematic APIs
        try {
          const proj = await eda.dmt_Project.getCurrentProjectInfo();
          const schPage = proj?.data?.[0]?.schematic?.page?.[0];
          if (schPage) {
            await eda.dmt_EditorControl.openDocument(schPage.uuid);
            await eda.dmt_EditorControl.activateDocument(schPage.uuid);
            await new Promise(r => setTimeout(r, 200));
          }
        } catch(e) {}
        // Manhattan orthogonal wire generator (strictly orthogonal, no diagonals)
        function makeOrthogonalLine(x1, y1, x2, y2, preferVertical = false) {
          x1 = Math.round(x1);
          y1 = Math.round(y1);
          x2 = Math.round(x2);
          y2 = Math.round(y2);

          if (x1 === x2 && y1 === y2) return [];
          if (x1 === x2 || y1 === y2) return [[x1, y1, x2, y2]];

          if (preferVertical) {
            return [
              [x1, y1, x1, y2],
              [x1, y2, x2, y2]
            ];
          } else {
            return [
              [x1, y1, x2, y1],
              [x2, y1, x2, y2]
            ];
          }
        }

        function getDirectionVector(dir) {
          switch (dir) {
            case 'right': return { dx: 1, dy: 0 };
            case 'left':  return { dx: -1, dy: 0 };
            case 'up':    return { dx: 0, dy: 1 };
            case 'down':  return { dx: 0, dy: -1 };
            default:      return { dx: 1, dy: 0 };
          }
        }

        async function createWire(line, net) {
          if (!line || line.length === 0) return null;
          for (const seg of line) {
            updateBounds(seg[0], seg[1], 10);
            updateBounds(seg[2], seg[3], 10);
          }
          const wire = await eda.sch_PrimitiveWire.create(line, net);
          if (wire) {
            const wid = wire.getState_PrimitiveId();
            createdWireIds.push(wid);
            return wire;
          }
          return null;
        }

        // Resolves port rotation according to port type and placement direction.
        // In EasyEDA Pro:
        // - OUT/BI ports: rot 0 has connection pin on the left, body extending right (+X).
        //   -> On rightward rails (dir='right'), rot 0 connects to wire on left.
        //   -> On leftward rails (dir='left'), rot 180 connects to wire on right.
        //   -> On upward rails (dir='up'), rot 270 connects to wire on bottom (-Y).
        //   -> On downward rails (dir='down'), rot 90 connects to wire on top (+Y).
        // - IN ports: rot 0 has connection pin on the right, body extending left (-X).
        //   -> On leftward rails (dir='left'), rot 0 connects to wire on right.
        //   -> On rightward rails (dir='right'), rot 180 connects to wire on left.
        //   -> On upward rails (dir='up'), rot 90 connects to wire on bottom (-Y).
        //   -> On downward rails (dir='down'), rot 270 connects to wire on top (+Y).
        function resolvePortRotation(portType, direction, explicitRot) {
          const pType = (portType || 'OUT').toUpperCase();
          const dir = direction;

          // Standard rotations for each orthogonal direction:
          // For OUT/BI: right: 0, left: 180, up: 270, down: 90
          // For IN:     left: 0,  right: 180, up: 90,  down: 270
          const standardRot = (pType === 'IN')
            ? (dir === 'left' ? 0 : dir === 'right' ? 180 : dir === 'up' ? 90 : dir === 'down' ? 270 : 0)
            : (dir === 'left' ? 180 : dir === 'right' ? 0 : dir === 'up' ? 270 : dir === 'down' ? 90 : 0);

          if (explicitRot !== undefined && explicitRot !== null) {
            // Auto-correct inverted port rotations when direction is known
            // Inverted means 180 degrees opposite to the standard connection orientation
            const invertedRot = (standardRot + 180) % 360;
            if (dir && explicitRot === invertedRot) {
              return standardRot;
            }
            return explicitRot;
          }

          return standardRot;
        }

        async function createPort(portType, net, x, y, rot = undefined, dir = undefined) {
          x = Math.round(x);
          y = Math.round(y);
          rot = resolvePortRotation(portType, dir, rot);
          updateBounds(x, y, 30);
          const port = await eda.sch_PrimitiveComponent.createNetPort(
            portType || 'OUT',
            net,
            x, y,
            rot,
            false
          );
          if (port) {
            const pid = port.getState_PrimitiveId();
            try {
              const attrIds = await eda.sch_PrimitiveAttribute.getAllPrimitiveId(pid);
              if (attrIds && attrIds.length > 0) {
                const attrs = await eda.sch_PrimitiveAttribute.get(attrIds);
                const list = Array.isArray(attrs) ? attrs : [attrs];
                for (const a of list) {
                  if (a && a.getState_Key?.() === 'Name') {
                    await eda.sch_PrimitiveAttribute.modify(a.getState_PrimitiveId(), {
                      value: String(net),
                      valueVisible: true
                    });
                  }
                }
              }
            } catch(e) {}
          }
          return port;
        }

        // Helper: resolve device from query / keyword / LCSC, checking project library first
        async function resolveDevice(compDef) {
          // If already a valid device object with symbolUuid
          if (compDef.deviceObj && compDef.deviceObj.symbolUuid) return compDef.deviceObj;

          const query = compDef.keyword || compDef.name || compDef.lcsc || compDef.uuid;
          if (!query) throw new Error('No search query or keyword provided for component: ' + compDef.id);

          // 1. Search Project Library FIRST
          try {
            const projLibUuid = await eda.lib_LibrariesList.getProjectLibraryUuid();
            if (projLibUuid) {
              const projList = await eda.lib_Device.search(query, projLibUuid);
              if (projList && projList.length > 0) {
                if (compDef.uuid) {
                  const match = projList.find(d => d.uuid === compDef.uuid);
                  if (match) return match;
                }
                return projList[0];
              }
            }
          } catch(e) {}

          // 2. Search System / Global Library
          try {
            const list = await eda.lib_Device.search(query);
            if (list && list.length > 0) {
              if (compDef.uuid) {
                const match = list.find(d => d.uuid === compDef.uuid);
                if (match) return match;
              }
              return list[0];
            }
          } catch(e) {}

          // 3. Search by LCSC
          if (compDef.lcsc) {
            try {
              const res = await eda.lib_Device.searchByProperties({ supplierId: compDef.lcsc }, undefined, undefined, undefined, 5, 1);
              if (res && res.length > 0) {
                return res[0];
              }
            } catch(e) {}

            try {
              const dev = await eda.lib_Device.getByLcscIds(compDef.lcsc);
              if (dev) return Array.isArray(dev) ? dev[0] : dev;
            } catch(e) {}
          }

          throw new Error('Could not resolve device for: ' + JSON.stringify(compDef));
        }


        // Helper: retrieve pin map of a component
        async function getComponentPinMap(comp) {
          const primId = comp.getState_PrimitiveId();
          let pins = [];
          try {
            if (comp.getAllPins) {
              pins = await comp.getAllPins();
            } else {
              pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(primId);
            }
          } catch(e) {
            pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(primId);
          }

          const pinMap = {};
          const pinList = [];
          for (const p of pins) {
            const num = String(p.pinNumber || (p.getState_PinNumber ? p.getState_PinNumber() : '') || '');
            const name = String(p.pinName || (p.getState_PinName ? p.getState_PinName() : '') || '');
            const x = Math.round(p.getState_X ? p.getState_X() : p.x);
            const y = Math.round(p.getState_Y ? p.getState_Y() : p.y);
            const rot = p.getState_Rotation ? p.getState_Rotation() : (p.rotation || 0);
            
            const info = { id: p.getState_PrimitiveId ? p.getState_PrimitiveId() : '', num, name, x, y, rot };
            if (num) pinMap[num] = info;
            if (name) pinMap[name] = info;
            pinList.push(info);
          }
          return { pins: pinList, pinMap };
        }

        // Helper: set component Designator (e.g. U1, C1) and Value/Name (e.g. 10uF)
        async function applyComponentLabels(primId, designatorVal, valueLabel) {
          try {
            const attrIds = await eda.sch_PrimitiveAttribute.getAllPrimitiveId(primId);
            if (!attrIds || attrIds.length === 0) return;
            const attrs = await eda.sch_PrimitiveAttribute.get(attrIds);
            const list = Array.isArray(attrs) ? attrs : [attrs];
            for (const a of list) {
              if (!a) continue;
              const k = a.getState_Key ? a.getState_Key() : '';
              if (k === 'Designator' && designatorVal) {
                await eda.sch_PrimitiveAttribute.modify(a.getState_PrimitiveId(), { value: String(designatorVal) });
              } else if ((k === 'Name' || k === 'Value') && valueLabel !== undefined) {
                const modProps = { value: String(valueLabel) };
                // If it's a primary IC (U*), place model name slightly above to avoid crossing bottom pin wires
                if (String(designatorVal).startsWith('U')) {
                  const currY = a.getState_Y ? a.getState_Y() : 0;
                  const currX = a.getState_X ? a.getState_X() : 0;
                  if (currY && currX) {
                    modProps.y = currY + 40;
                    modProps.x = currX + 25;
                  }
                }
                await eda.sch_PrimitiveAttribute.modify(a.getState_PrimitiveId(), modProps);
              } else if (k === 'Manufacturer Part' && valueLabel !== undefined) {
                await eda.sch_PrimitiveAttribute.modify(a.getState_PrimitiveId(), { valueVisible: false });
              }
            }
          } catch(e) {}
        }

        // Helper: targeted wire-label hiding (only inspecting newly created wires)
        async function hideRedundantWireLabels() {
          for (const wid of createdWireIds) {
            try {
              const attrIds = await eda.sch_PrimitiveAttribute.getAllPrimitiveId(wid);
              if (!attrIds || attrIds.length === 0) continue;
              const attrs = await eda.sch_PrimitiveAttribute.get(attrIds);
              const list = Array.isArray(attrs) ? attrs : [attrs];
              for (const a of list) {
                if (!a) continue;
                const k = a.getState_Key ? a.getState_Key() : '';
                const v = a.getState_Value ? a.getState_Value() : '';
                if (k === 'Name' && (!v || v === '')) {
                  await eda.sch_PrimitiveAttribute.modify(a.getState_PrimitiveId(), { valueVisible: false });
                }
              }
            } catch(e) {}
          }
        }

        // Process each module in specification
        for (const mod of spec.modules) {
          const baseX = mod.origin?.x || 3500;
          const baseY = mod.origin?.y || 3000;
          updateBounds(baseX, baseY, 80);

          // 1. Place Primary Components
          for (const compSpec of (mod.primaryComponents || [])) {
            const dev = await resolveDevice(compSpec);
            const posX = baseX + (compSpec.offset?.x || 0);
            const posY = baseY + (compSpec.offset?.y || 0);
            const rot = compSpec.rotation || 0;

            // Pass addIntoLibrary: false to avoid version conflict modal dialog
            const comp = await eda.sch_PrimitiveComponent.create(
              dev, posX, posY, undefined, rot, false, true, false
            );

            const primId = comp.getState_PrimitiveId();
            await applyComponentLabels(primId, compSpec.id, compSpec.value || compSpec.name);
            const pinData = await getComponentPinMap(comp);

            results.components[compSpec.id] = {
              id: compSpec.id,
              primitiveId: primId,
              x: posX,
              y: posY,
              rotation: rot,
              pins: pinData.pinMap
            };
            updateBounds(posX, posY, 60);
          }

          // 2. Process Ties (direct jumpers between pins on same/different component)
          for (const tie of (mod.ties || [])) {
            const compA = results.components[tie.from.comp];
            const compB = results.components[tie.to.comp];
            if (!compA || !compB) continue;

            const pinA = compA.pins[String(tie.from.pin)];
            const pinB = compB.pins[String(tie.to.pin)];
            if (!pinA || !pinB) continue;

            const wireLine = makeOrthogonalLine(pinA.x, pinA.y, pinB.x, pinB.y);
            if (wireLine.length > 0) {
              const wire = await createWire(wireLine);
              results.wires.push({
                from: tie.from.comp + '.' + tie.from.pin,
                to: tie.to.comp + '.' + tie.to.pin,
                primitiveId: wire ? wire.getState_PrimitiveId() : null
              });
            }
          }

          // 3. Process Rails (with jog, series components, branches, dividers, flags & ports)
          for (const rail of (mod.rails || [])) {
            const sourceComp = results.components[rail.from.comp];
            if (!sourceComp) continue;
            const startPin = sourceComp.pins[String(rail.from.pin)];
            if (!startPin) continue;

            const dir = rail.direction || 'right';
            const uDir = getDirectionVector(dir);

            let currX = startPin.x;
            let currY = startPin.y;
            updateBounds(currX, currY, 20);

            // 3a. Handle Jog
            if (rail.jog) {
              const jogDx = Math.round(rail.jog.dx || 0);
              const jogDy = Math.round(rail.jog.dy || 0);
              const jogTargetX = currX + jogDx;
              const jogTargetY = currY + jogDy;

              const jogWire = makeOrthogonalLine(currX, currY, jogTargetX, jogTargetY, !!rail.jog.preferVertical);
              if (jogWire.length > 0) {
                const wire = await createWire(jogWire);
                results.wires.push({
                  from: rail.from.comp + '.' + rail.from.pin,
                  to: 'JogEnd(' + jogTargetX + ',' + jogTargetY + ')',
                  primitiveId: wire ? wire.getState_PrimitiveId() : null
                });
              }
              currX = jogTargetX;
              currY = jogTargetY;
              updateBounds(currX, currY, 20);
            }

            // 3b. Handle Series Components along the rail
            for (const sItem of (rail.series || [])) {
              // Tap before series component
              if (sItem.tapBefore) {
                if (sItem.tapBefore.port) {
                  const pSpec = sItem.tapBefore.port;
                  let pX = currX;
                  let pY = currY;
                  const pDirName = pSpec.direction || (dir === 'left' ? 'left' : 'right');
                  if (pSpec.stubLength) {
                    const sDir = getDirectionVector(pDirName);
                    pX = currX + sDir.dx * pSpec.stubLength;
                    pY = currY + sDir.dy * pSpec.stubLength;
                    await createWire(makeOrthogonalLine(currX, currY, pX, pY));
                  }
                  const port = await createPort(
                    pSpec.portType || pSpec.type || 'BI',
                    pSpec.net,
                    pX, pY,
                    pSpec.rotation,
                    pDirName
                  );
                  results.ports.push({ net: pSpec.net, primitiveId: port ? port.getState_PrimitiveId() : null });
                  updateBounds(pX, pY, 30);
                }
                if (sItem.tapBefore.flag) {
                  const fSpec = sItem.tapBefore.flag;
                  const flag = await eda.sch_PrimitiveComponent.createNetFlag(
                    fSpec.type || 'Power',
                    fSpec.net,
                    currX, currY,
                    fSpec.rotation !== undefined ? fSpec.rotation : 0,
                    false
                  );
                  results.flags.push({ net: fSpec.net, primitiveId: flag ? flag.getState_PrimitiveId() : null });
                  updateBounds(currX, currY, 30);
                }
              }

              // Place series component
              const sCompSpec = sItem.component;
              const sDev = await resolveDevice(sCompSpec);
              const sRot = sCompSpec.rotation !== undefined ? sCompSpec.rotation : (uDir.dy !== 0 ? 90 : 0);
              const wireLen = sItem.wireLength !== undefined ? sItem.wireLength : 30;

              const estCenterX = currX + uDir.dx * (wireLen + 20);
              const estCenterY = currY + uDir.dy * (wireLen + 20);

              const sComp = await eda.sch_PrimitiveComponent.create(
                sDev, estCenterX, estCenterY, undefined, sRot, false, true, false
              );
              const sPrimId = sComp.getState_PrimitiveId();
              await applyComponentLabels(sPrimId, sCompSpec.id, sCompSpec.value || sCompSpec.name);
              const sPinData = await getComponentPinMap(sComp);

              // Sort pins along travel direction
              let pinIn, pinOut;
              if (uDir.dx > 0) { // Moving right
                const sorted = [...sPinData.pins].sort((a, b) => a.x - b.x);
                pinIn = sorted[0];
                pinOut = sorted[sorted.length - 1];
              } else if (uDir.dx < 0) { // Moving left
                const sorted = [...sPinData.pins].sort((a, b) => b.x - a.x);
                pinIn = sorted[0];
                pinOut = sorted[sorted.length - 1];
              } else if (uDir.dy > 0) { // Moving up
                const sorted = [...sPinData.pins].sort((a, b) => a.y - b.y);
                pinIn = sorted[0];
                pinOut = sorted[sorted.length - 1];
              } else { // Moving down
                const sorted = [...sPinData.pins].sort((a, b) => b.y - a.y);
                pinIn = sorted[0];
                pinOut = sorted[sorted.length - 1];
              }

              // Connect curr to pinIn
              const inWire = makeOrthogonalLine(currX, currY, pinIn.x, pinIn.y);
              if (inWire.length > 0) {
                await createWire(inWire);
              }

              results.components[sCompSpec.id] = {
                id: sCompSpec.id,
                primitiveId: sPrimId,
                x: estCenterX,
                y: estCenterY,
                pins: sPinData.pinMap
              };
              updateBounds(estCenterX, estCenterY, 40);

              // Update curr to pinOut
              currX = pinOut.x;
              currY = pinOut.y;

              // Tap after series component
              if (sItem.tapAfter) {
                if (sItem.tapAfter.port) {
                  const pSpec = sItem.tapAfter.port;
                  let pX = currX;
                  let pY = currY;
                  const pDirName = pSpec.direction || (dir === 'left' ? 'left' : 'right');
                  if (pSpec.stubLength) {
                    const sDir = getDirectionVector(pDirName);
                    pX = currX + sDir.dx * pSpec.stubLength;
                    pY = currY + sDir.dy * pSpec.stubLength;
                    await createWire(makeOrthogonalLine(currX, currY, pX, pY));
                  }
                  const port = await createPort(
                    pSpec.portType || pSpec.type || 'BI',
                    pSpec.net,
                    pX, pY,
                    pSpec.rotation,
                    pDirName
                  );
                  results.ports.push({ net: pSpec.net, primitiveId: port ? port.getState_PrimitiveId() : null });
                  updateBounds(pX, pY, 30);
                }
              }
            }

            // 3c. Main Rail Extension
            const railStartX = currX;
            const railStartY = currY;
            const totalLen = rail.length || 0;

            if (totalLen > 0) {
              const endX = railStartX + uDir.dx * totalLen;
              const endY = railStartY + uDir.dy * totalLen;

              const mainWireNet = (rail.flag || rail.port) ? undefined : (rail.net || undefined);
              const mainRailLine = makeOrthogonalLine(railStartX, railStartY, endX, endY);
              const railWire = await createWire(mainRailLine, mainWireNet);
              results.wires.push({
                name: rail.name,
                from: 'RailStart(' + railStartX + ',' + railStartY + ')',
                to: 'RailEnd(' + endX + ',' + endY + ')',
                primitiveId: railWire ? railWire.getState_PrimitiveId() : null
              });
              currX = endX;
              currY = endY;
              updateBounds(endX, endY, 30);
            }

            // 3d. Rail Termination: Flag or Port
            if (rail.flag) {
              let fX = currX;
              let fY = currY;
              if (rail.flag.stubLength) {
                const sDir = getDirectionVector(rail.flag.direction || dir);
                fX = currX + sDir.dx * rail.flag.stubLength;
                fY = currY + sDir.dy * rail.flag.stubLength;
                await createWire(makeOrthogonalLine(currX, currY, fX, fY));
              }
              const flag = await eda.sch_PrimitiveComponent.createNetFlag(
                rail.flag.type || 'Power',
                rail.flag.net || rail.net,
                fX,
                fY,
                rail.flag.rotation !== undefined ? rail.flag.rotation : 0,
                false
              );
              results.flags.push({
                type: rail.flag.type,
                net: rail.flag.net,
                primitiveId: flag ? flag.getState_PrimitiveId() : null
              });
              updateBounds(fX, fY, 30);
            } else if (rail.port) {
              let pX = currX;
              let pY = currY;
              const pDirName = rail.port.direction || dir;
              if (rail.port.stubLength) {
                const sDir = getDirectionVector(pDirName);
                pX = currX + sDir.dx * rail.port.stubLength;
                pY = currY + sDir.dy * rail.port.stubLength;
                await createWire(makeOrthogonalLine(currX, currY, pX, pY));
              }
              const port = await createPort(
                rail.port.portType || rail.port.type || 'OUT',
                rail.port.net || rail.net,
                pX,
                pY,
                rail.port.rotation,
                pDirName
              );
              results.ports.push({
                type: rail.port.portType || rail.port.type,
                net: rail.port.net,
                primitiveId: port ? port.getState_PrimitiveId() : null
              });
              updateBounds(pX, pY, 30);
            }

            // 3e. Branches (e.g. bypass capacitors hanging below the rail)
            for (const branch of (rail.branches || [])) {
              const branchDist = branch.atDistance || (totalLen / 2);
              const tapX = railStartX + uDir.dx * branchDist;
              const tapY = railStartY + uDir.dy * branchDist;

              const branchLen = branch.branchLength || 40;
              const topPinTargetY = tapY - branchLen; // -Y is DOWN

              const dev = await resolveDevice(branch.component);
              const compRot = branch.component.rotation !== undefined ? branch.component.rotation : 90;
              const estCenterY = topPinTargetY - 20;

              const comp = await eda.sch_PrimitiveComponent.create(
                dev, tapX, estCenterY, undefined, compRot, false, true, false
              );
              const primId = comp.getState_PrimitiveId();
              await applyComponentLabels(primId, branch.component.id, branch.component.value || branch.component.name);
              const pinData = await getComponentPinMap(comp);

              const sortedPins = [...pinData.pins].sort((a, b) => b.y - a.y);
              const topPin = sortedPins[0];
              const bottomPin = sortedPins[sortedPins.length - 1];

              results.components[branch.component.id] = {
                id: branch.component.id,
                primitiveId: primId,
                x: tapX,
                y: estCenterY,
                pins: pinData.pinMap
              };
              updateBounds(tapX, estCenterY, 40);

              // Wire from tap to top pin
              const topWireLine = makeOrthogonalLine(tapX, tapY, topPin.x, topPin.y);
              if (topWireLine.length > 0) {
                await createWire(topWireLine);
              }

              // Ground stub from bottom pin
              const gndStubLen = branch.groundStub || 30;
              const gndEndY = bottomPin.y - gndStubLen;
              await createWire([[bottomPin.x, bottomPin.y, bottomPin.x, gndEndY]]);

              // Ground flag
              const gndFlag = await eda.sch_PrimitiveComponent.createNetFlag(
                'Ground',
                'GND',
                bottomPin.x,
                gndEndY,
                0,
                false
              );
              results.flags.push({
                type: 'Ground',
                net: 'GND',
                primitiveId: gndFlag ? gndFlag.getState_PrimitiveId() : null
              });
              updateBounds(bottomPin.x, gndEndY, 30);
            }

            // 3f. Voltage Dividers
            const dividersList = rail.dividers || (rail.divider ? [rail.divider] : []);
            for (const div of dividersList) {
              const divDist = div.atDistance || (totalLen / 2);
              const divTapX = railStartX + uDir.dx * divDist;
              const divTapY = railStartY + uDir.dy * divDist;

              const branchLen = div.branchLength || 45;
              const spacing = div.dividerSpacing || 45;
              const gndStubLen = div.groundStub || 25;

              // Top Resistor
              const topDev = await resolveDevice(div.topResistor);
              const topRot = div.topResistor.rotation !== undefined ? div.topResistor.rotation : 90;
              const estTopCenterY = divTapY - branchLen;
              const topComp = await eda.sch_PrimitiveComponent.create(
                topDev, divTapX, estTopCenterY, undefined, topRot, false, true, false
              );
              const topPrimId = topComp.getState_PrimitiveId();
              await applyComponentLabels(topPrimId, div.topResistor.id, div.topResistor.value || div.topResistor.name);
              const topPinData = await getComponentPinMap(topComp);
              const topSorted = [...topPinData.pins].sort((a, b) => b.y - a.y);
              const topPin1 = topSorted[0]; // Higher Y
              const topPin2 = topSorted[topSorted.length - 1]; // Lower Y

              results.components[div.topResistor.id] = {
                id: div.topResistor.id,
                primitiveId: topPrimId,
                x: divTapX,
                y: estTopCenterY,
                pins: topPinData.pinMap
              };

              // Wire from rail tap to topPin1
              await createWire(makeOrthogonalLine(divTapX, divTapY, topPin1.x, topPin1.y));

              // Bottom Resistor
              const botDev = await resolveDevice(div.bottomResistor);
              const botRot = div.bottomResistor.rotation !== undefined ? div.bottomResistor.rotation : 90;
              const midY = topPin2.y;
              const estBotCenterY = midY - spacing;
              const botComp = await eda.sch_PrimitiveComponent.create(
                botDev, divTapX, estBotCenterY, undefined, botRot, false, true, false
              );
              const botPrimId = botComp.getState_PrimitiveId();
              await applyComponentLabels(botPrimId, div.bottomResistor.id, div.bottomResistor.value || div.bottomResistor.name);
              const botPinData = await getComponentPinMap(botComp);
              const botSorted = [...botPinData.pins].sort((a, b) => b.y - a.y);
              const botPin1 = botSorted[0]; // Higher Y
              const botPin2 = botSorted[botSorted.length - 1]; // Lower Y

              results.components[div.bottomResistor.id] = {
                id: div.bottomResistor.id,
                primitiveId: botPrimId,
                x: divTapX,
                y: estBotCenterY,
                pins: botPinData.pinMap
              };

              // Wire between top resistor bottom pin and bottom resistor top pin
              await createWire(makeOrthogonalLine(topPin2.x, topPin2.y, botPin1.x, botPin1.y));

              // Midpoint Tap Port
              if (div.tapPort) {
                const pSpec = div.tapPort;
                const stubLen = pSpec.stubLength !== undefined ? pSpec.stubLength : 30;
                const pDirName = pSpec.direction || 'right';
                const pDir = getDirectionVector(pDirName);
                const portX = divTapX + pDir.dx * stubLen;
                const portY = midY + pDir.dy * stubLen;
                if (stubLen > 0) {
                  await createWire(makeOrthogonalLine(divTapX, midY, portX, portY));
                }
                const port = await createPort(
                  pSpec.portType || pSpec.type || 'OUT',
                  pSpec.net,
                  portX, portY,
                  pSpec.rotation,
                  pDirName
                );
                results.ports.push({ net: pSpec.net, primitiveId: port ? port.getState_PrimitiveId() : null });
                updateBounds(portX, portY, 30);
              }

              // Ground stub from bottom resistor bottom pin
              const gndEndY = botPin2.y - gndStubLen;
              await createWire([[botPin2.x, botPin2.y, botPin2.x, gndEndY]]);
              const gndFlag = await eda.sch_PrimitiveComponent.createNetFlag(
                'Ground',
                'GND',
                botPin2.x,
                gndEndY,
                0,
                false
              );
              results.flags.push({
                type: 'Ground',
                net: 'GND',
                primitiveId: gndFlag ? gndFlag.getState_PrimitiveId() : null
              });
              updateBounds(divTapX, gndEndY, 30);
            }
          }

          // 4. Ground Pins on Components (e.g. Pin 5 GND)
          for (const gndSpec of (mod.groundPins || [])) {
            const comp = results.components[gndSpec.comp];
            if (!comp) continue;
            const pin = comp.pins[String(gndSpec.pin)];
            if (!pin) continue;

            const gDir = gndSpec.direction || 'down';
            const uGDir = getDirectionVector(gDir);
            const stubLen = gndSpec.stubLength || 35;
            const gndEndX = pin.x + uGDir.dx * stubLen;
            const gndEndY = pin.y + uGDir.dy * stubLen;

            const defRot = gDir === 'right' ? 270 : (gDir === 'left' ? 90 : (gDir === 'up' ? 180 : 0));
            const flagRot = gndSpec.rotation !== undefined ? gndSpec.rotation : defRot;

            const wire = await createWire([[pin.x, pin.y, gndEndX, gndEndY]]);
            results.wires.push({
              from: gndSpec.comp + '.' + gndSpec.pin,
              to: 'GND(' + gndEndX + ',' + gndEndY + ')',
              primitiveId: wire ? wire.getState_PrimitiveId() : null
            });

            const flag = await eda.sch_PrimitiveComponent.createNetFlag(
              'Ground',
              'GND',
              gndEndX,
              gndEndY,
              flagRot,
              false
            );
            results.flags.push({
              type: 'Ground',
              net: 'GND',
              primitiveId: flag ? flag.getState_PrimitiveId() : null
            });
            updateBounds(gndEndX, gndEndY, 30);
          }

          // 5. Standalone Net Ports / Flags
          for (const np of (mod.netPorts || [])) {
            const comp = results.components[np.comp];
            if (!comp) continue;
            const pin = comp.pins[String(np.pin)];
            if (!pin) continue;

            const pDirName = np.direction || 'right';
            const pDir = getDirectionVector(pDirName);
            const stubLen = np.stubLength || 30;
            const portX = pin.x + pDir.dx * stubLen;
            const portY = pin.y + pDir.dy * stubLen;

            if (stubLen > 0) {
              await createWire(makeOrthogonalLine(pin.x, pin.y, portX, portY));
            }

            const port = await createPort(
              np.portType || np.type || 'OUT',
              np.net,
              portX, portY,
              np.rotation,
              pDirName
            );
            results.ports.push({
              type: np.portType || np.type,
              net: np.net,
              primitiveId: port ? port.getState_PrimitiveId() : null
            });
            updateBounds(portX, portY, 30);
          }
        }

        // Targeted hide redundant auto-generated Name labels on wire segments
        await hideRedundantWireLabels();

        // Save and render the generated circuit region
        try {
          await eda.sch_Document.save();
          await new Promise(r => setTimeout(r, 400));
          const proj = await eda.dmt_Project.getCurrentProjectInfo();
          const sch = proj?.data?.[0]?.schematic;
          const page = sch?.page?.[0];

          let renderBox = spec.renderRegion || null;
          if (!renderBox && isFinite(bounds.minX) && isFinite(bounds.maxX)) {
            const pad = 60;
            renderBox = {
              minX: Math.round(bounds.minX - pad),
              minY: Math.round(bounds.minY - pad),
              maxX: Math.round(bounds.maxX + pad),
              maxY: Math.round(bounds.maxY + pad)
            };
          }
          if (!renderBox) {
            renderBox = { minX: 3000, minY: 2500, maxX: 4000, maxY: 3500 };
          }

          const renderWidth = spec.renderWidth || 1500;
          const renderRes = await eda.sch_Document.renderRegion({
            projectId: proj.uuid,
            schematicName: sch.name,
            pageName: page.name,
            region: renderBox,
            width: renderWidth,
            format: 'png'
          });

          if (renderRes && renderRes.ok && renderRes.value) {
            const buf = await renderRes.value.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let bin = '';
            for (let i = 0; i < bytes.byteLength; i++) {
              bin += String.fromCharCode(bytes[i]);
            }
            results.screenshotBase64 = btoa(bin);
          }
        } catch(e) {
          results.renderError = e.message;
        }

        return { ok: true, results };
      } catch (err) {
        return { ok: false, error: err.message, stack: err.stack, results };
      } finally {
        if (dialogWatcherId) {
          clearInterval(dialogWatcherId);
        }
      }
    `;
  }
}
