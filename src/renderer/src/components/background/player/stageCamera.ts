export type WorldPoint = readonly [x: number, y: number, z: number]

interface CameraPose {
  eye: WorldPoint
  target: WorldPoint
  lens: number
}

interface CameraShot {
  from: WorldPoint
  to: WorldPoint
  target: WorldPoint
  lens: number
  minHold: number
  maxHold: number
}

export interface ScreenPoint {
  x: number
  y: number
  depth: number
}

export interface Project {
  (world: WorldPoint): ScreenPoint | null
  depth(world: WorldPoint): number
}

const NEAR = 2

const cameraAngles = [
  // Rear concourse on the runway axis.
  {
    from: [0, 26, -110],
    to: [0, 30, -99],
    target: [0, 10, -4],
    lens: 0.96,
    minHold: 5.5,
    maxHold: 12
  },
  // A dolly just above the floor seats, with the thrust platform in frame.
  {
    from: [5, 9, -69],
    to: [3, 10.5, -57],
    target: [0, 12, 12],
    lens: 1.03,
    minHold: 5.1,
    maxHold: 10.5
  },
  // A short diagonal move in front of the stage, from the deck to the lighting rig.
  {
    from: [-4.7, 8.25, -29.5],
    to: [4.1, 8.65, -25.8],
    target: [0, 13.1, 15],
    lens: 0.87,
    minHold: 4.1,
    maxHold: 8.6
  },
  // Elevated side stand, looking across the floor toward the opposite bowl.
  {
    from: [-86, 33, -34],
    to: [-77, 40, -30],
    target: [7, 11, -10],
    lens: 0.86,
    minHold: 5.7,
    maxHold: 12
  },
  // A tracking camera outside the runway fence, looking past its lit edge.
  {
    from: [20, 5.2, -56],
    to: [16.5, 5.8, -52],
    target: [-2, 2.5, -28],
    lens: 0.85,
    minHold: 4.8,
    maxHold: 10.5
  },
  // A medium shot of the right cover screen and the backline beneath it.
  {
    from: [30.5, 12.5, -13],
    to: [36.4, 11, -7.8],
    target: [43.8, 11, 19],
    lens: 0.96,
    minHold: 4.4,
    maxHold: 8.8
  }
] as const

const cheerOverlook = {
  from: [-123, 30.5, -73],
  to: [-118, 29.8, -69],
  target: [11, 7, -61],
  lens: 0.82,
  minHold: 6.2,
  maxHold: 11.5
} as const

const rearStandShots: readonly CameraShot[] = [
  // Track the continuous upper bowl from the side, with the rear curve in the center.
  {
    from: [-98, 32, -28],
    to: [-90, 34, -33],
    target: [13, 15, -82],
    lens: 0.88,
    minHold: 5.5,
    maxHold: 9.5
  },
  // Reverse the view from behind the rear seats down the runway axis.
  {
    from: [-12, 32.5, -141],
    to: [10, 33.3, -133],
    target: [0, 10.5, -10],
    lens: 0.89,
    minHold: 5.6,
    maxHold: 9.8
  }
]

const shots: readonly CameraShot[] = [
  cameraAngles[0],
  cameraAngles[3],
  cheerOverlook,
  ...rearStandShots,
  cameraAngles[1],
  cameraAngles[4],
  cameraAngles[2],
  cameraAngles[5]
]

export class StageDirector {
  private shot = 0
  private elapsed = 0
  private beats = 0

  advance(dt: number): void {
    this.elapsed += dt
    if (this.elapsed >= shots[this.shot].maxHold) this.cut()
  }

  onBeat(accent: number): void {
    this.beats++
    if (this.elapsed >= shots[this.shot].minHold && (this.beats % 4 === 0 || accent >= 0.72))
      this.cut()
  }

  pose(): CameraPose {
    const { from, to, target, lens, maxHold } = shots[this.shot]
    const progress = Math.min(1, this.elapsed / maxHold)
    // Keep moving throughout the shot while easing into the camera move.
    const travel = progress * (0.62 + 0.38 * progress)
    return {
      eye: [
        from[0] + (to[0] - from[0]) * travel,
        from[1] + (to[1] - from[1]) * travel,
        from[2] + (to[2] - from[2]) * travel
      ],
      target,
      lens
    }
  }

  private cut(): void {
    this.shot = (this.shot + 1) % shots.length
    this.elapsed = 0
    this.beats = 0
  }
}

export function stageProjection(pose: CameraPose, width: number, height: number): Project {
  const { eye, target, lens } = pose
  const [dx, dy, dz] = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]
  const horizontal = Math.hypot(dx, dz)
  const distance = Math.hypot(horizontal, dy)
  const [fx, fy, fz] = [dx / distance, dy / distance, dz / distance]
  const [rx, rz] = [dz / horizontal, -dx / horizontal]
  const [ux, uy, uz] = [(-fx * dy) / horizontal, horizontal / distance, (-fz * dy) / horizontal]
  const focal = Math.min(height * lens, width * 0.68)
  const project: Project = ([x, y, z]) => {
    const [vx, vy, vz] = [x - eye[0], y - eye[1], z - eye[2]]
    const depth = vx * fx + vy * fy + vz * fz
    if (depth < NEAR) return null
    const scale = focal / depth
    return {
      x: width / 2 + (vx * rx + vz * rz) * scale,
      y: height * 0.48 - (vx * ux + vy * uy + vz * uz) * scale,
      depth
    }
  }
  project.depth = ([x, y, z]) => (x - eye[0]) * fx + (y - eye[1]) * fy + (z - eye[2]) * fz
  return project
}

export function projectFace(vertices: readonly WorldPoint[], project: Project): ScreenPoint[] {
  const points: ScreenPoint[] = []
  let previous = vertices[vertices.length - 1]
  let projectedPrevious = project(previous)
  for (const vertex of vertices) {
    const projected = project(vertex)
    if (Boolean(projectedPrevious) !== Boolean(projected)) {
      const from = project.depth(previous)
      const to = project.depth(vertex)
      const t = (NEAR + 0.001 - from) / (to - from)
      const edge = project([
        previous[0] + (vertex[0] - previous[0]) * t,
        previous[1] + (vertex[1] - previous[1]) * t,
        previous[2] + (vertex[2] - previous[2]) * t
      ])
      if (edge) points.push(edge)
    }
    if (projected) points.push(projected)
    previous = vertex
    projectedPrevious = projected
  }
  return points
}
