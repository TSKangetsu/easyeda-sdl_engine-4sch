/**
 * Geometric and Manhattan Wire Router for EasyEDA Pro
 * All coordinates in EasyEDA Schematic units (10 mil = 0.01 inch)
 * EasyEDA Schematic Coordinate System: +X is RIGHT, -X is LEFT, +Y is UP, -Y is DOWN.
 */

export class SchRouter {
  /**
   * Determine directional vector for a given cardinal direction
   * @param {'right'|'left'|'up'|'down'} direction
   * @returns {{dx: number, dy: number}}
   */
  static getDirectionVector(direction = 'right') {
    switch (direction) {
      case 'right': return { dx: 1, dy: 0 };
      case 'left':  return { dx: -1, dy: 0 };
      case 'up':    return { dx: 0, dy: 1 };
      case 'down':  return { dx: 0, dy: -1 };
      default:      return { dx: 1, dy: 0 };
    }
  }

  /**
   * Determine pin direction from rotation (in degrees)
   * Pin rotation 0 points East (+X), 90 points North (+Y), 180 points West (-X), 270 points South (-Y)
   */
  static getPinVector(rotation = 0) {
    const rot = ((rotation % 360) + 360) % 360;
    switch (rot) {
      case 0:   return { dx: 1, dy: 0 };  // East / Right
      case 90:  return { dx: 0, dy: 1 };  // North / Up (+Y in schematic)
      case 180: return { dx: -1, dy: 0 }; // West / Left
      case 270: return { dx: 0, dy: -1 }; // South / Down (-Y in schematic)
      default:
        const rad = (rot * Math.PI) / 180;
        return { dx: Math.round(Math.cos(rad)), dy: Math.round(Math.sin(rad)) };
    }
  }

  /**
   * Create strictly orthogonal Manhattan line segments between two points
   * @param {number} x1
   * @param {number} y1
   * @param {number} x2
   * @param {number} y2
   * @param {boolean} preferVertical If true, vertical segment comes first
   * @returns {Array<Array<number>>} Wire segments [[x1, y1, x2, y2], ...]
   */
  static makeOrthogonalLine(x1, y1, x2, y2, preferVertical = false) {
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

  /**
   * Route a jog offset wire from start point
   * @param {{x: number, y: number}} start
   * @param {{dx: number, dy: number, preferVertical?: boolean}} jog
   * @returns {{segments: Array<Array<number>>, end: {x: number, y: number}}}
   */
  static routeJog(start, jog) {
    const pX = Math.round(start.x);
    const pY = Math.round(start.y);
    const targetX = pX + Math.round(jog.dx || 0);
    const targetY = pY + Math.round(jog.dy || 0);

    const segments = this.makeOrthogonalLine(pX, pY, targetX, targetY, !!jog.preferVertical);
    return {
      segments,
      end: { x: targetX, y: targetY }
    };
  }

  /**
   * Create a stub wire extending outward from a pin
   * @param {{x: number, y: number, rotation?: number}} pin
   * @param {number} length Default 40
   * @param {'right'|'left'|'up'|'down'|null} direction
   */
  static createStub(pin, length = 40, direction = null) {
    const pX = Math.round(pin.x);
    const pY = Math.round(pin.y);

    const v = direction ? this.getDirectionVector(direction) : this.getPinVector(pin.rotation || 0);
    const endX = pX + v.dx * length;
    const endY = pY + v.dy * length;

    return {
      wire: [[pX, pY, endX, endY]],
      terminal: { x: endX, y: endY },
      direction: v
    };
  }

  /**
   * Create a Z-shaped Manhattan wire between two points
   * @param {{x: number, y: number}} p1 Start point
   * @param {{x: number, y: number}} p2 End point
   * @param {Object} options Options like channelX or channelY, preferVertical
   * @returns {Array<Array<number>>} Wire segments [[x1, y1, x2, y2], ...]
   */
  static routeOrthogonal(p1, p2, options = {}) {
    const x1 = Math.round(p1.x);
    const y1 = Math.round(p1.y);
    const x2 = Math.round(p2.x);
    const y2 = Math.round(p2.y);

    // Pure horizontal
    if (y1 === y2) {
      return [[x1, y1, x2, y2]];
    }

    // Pure vertical
    if (x1 === x2) {
      return [[x1, y1, x2, y2]];
    }

    if (options.preferVertical) {
      const midY = options.channelY !== undefined ? Math.round(options.channelY) : Math.round((y1 + y2) / 2);
      const segments = [];
      if (y1 !== midY) segments.push([x1, y1, x1, midY]);
      segments.push([x1, midY, x2, midY]);
      if (midY !== y2) segments.push([x2, midY, x2, y2]);
      return segments;
    } else {
      const midX = options.channelX !== undefined ? Math.round(options.channelX) : Math.round((x1 + x2) / 2);
      const segments = [];
      if (x1 !== midX) segments.push([x1, y1, midX, y1]);
      segments.push([midX, y1, midX, y2]);
      if (midX !== x2) segments.push([midX, y2, x2, y2]);
      return segments;
    }
  }
}
