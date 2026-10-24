// Which storey of a building you are on (written by Interiors.vue every
// frame, read by the player avatar and the camera). `y` is the height of
// your feet above the ground floor, including part-way up a staircase.
export const interiorLevel = {
  levels: 1,
  level: 0,
  /** stair you are on (its lower floor index), or -1 */
  stair: -1,
  y: 0,
  reset() {
    this.levels = 1
    this.level = 0
    this.stair = -1
    this.y = 0
  }
}
