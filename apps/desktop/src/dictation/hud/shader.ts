// Dot scope's plate, glow and dots: Hex's `src/rune_hud.wgsl`
// (`dot_scope_fragment`, MIT, © 2026 Christopher Langton) in GLSL ES 3.0,
// without the notch island. Positions are in points from the canvas's middle,
// y down; colours are sRGB-encoded and premultiplied. The macOS HUD draws the
// same shader in Metal (`crates/dictation-ui-macos`).

export const VERTEX_SHADER = `#version 300 es
out vec2 uv;
void main() {
  vec2 positions[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  vec2 p = positions[gl_VertexID];
  uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

in vec2 uv;
out vec4 color;

// x, y: resolution (device px), z: backing scale, w: dot pitch (pt)
uniform vec4 metrics0;
// plate width, height, opacity, scale
uniform vec4 metrics1;
// softness, columns, rows, corner radius
uniform vec4 metrics2;
// glow, grid, live, cool
uniform vec4 state;
// rgb; base.w: 1 in the dark appearance
uniform vec4 base;
uniform vec4 core;
uniform vec4 plate;
uniform vec4 rim;
uniform vec4 shadow;
// Each dot's (brightness, freshness) at (column, row).
uniform sampler2D dots;

float sstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float rounded_box(vec2 point, vec2 half_size, float radius) {
  vec2 q = abs(point) - half_size + radius;
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - radius;
}

float coverage(float distance, float softness) {
  return sstep(softness, -softness, distance);
}

void composite(inout vec4 destination, vec3 c, float alpha_in) {
  float alpha = clamp(alpha_in, 0.0, 1.0);
  destination = vec4(c * alpha + destination.rgb * (1.0 - alpha), alpha + destination.a * (1.0 - alpha));
}

vec4 dithered(vec4 result_in, vec2 position) {
  vec4 result = result_in;
  if (result.a > 0.0) {
    vec2 pixel = floor(position);
    float n1 = fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
    float n2 = fract(52.9829189 * fract(dot(pixel + vec2(17.0, 31.0), vec2(0.06711056, 0.00583715))));
    float dither = ((n1 - n2) / 255.0) * result.a;
    result = vec4(clamp(result.rgb + vec3(dither), vec3(0.0), vec3(result.a)), result.a);
  }
  return result;
}

void main() {
  vec2 resolution = metrics0.xy;
  float backing_scale = metrics0.z;
  float pitch = metrics0.w;
  float width = metrics1.x;
  float height = metrics1.y;
  float opacity = metrics1.z;
  float scale = max(metrics1.w, 0.001);
  float softness = max(metrics2.x, 0.0);
  int columns = int(metrics2.y + 0.5);
  int rows = int(metrics2.z + 0.5);
  float glow = state.x;
  float grid = state.y;
  float live = state.z;
  float cool = state.w;
  bool dark = base.w > 0.5;

  vec2 position = uv * resolution;
  vec2 window_point = (position - resolution * 0.5) / backing_scale;
  vec2 point = window_point / scale;
  float pixel = 1.0 / (backing_scale * scale);
  float aa = pixel * 0.75 + softness * 0.72;
  vec2 half_size = vec2(width, height) * 0.5;
  float radius = clamp(metrics2.w, 0.0, height * 0.5);
  float distance = rounded_box(point, half_size, radius);
  vec4 result = vec4(0.0);

  // A soft drop shadow 3 pt below.
  float shadow_distance = rounded_box(point - vec2(0.0, 3.0), half_size, radius);
  composite(result, shadow.rgb, shadow.a * (0.5 - 0.5 * tanh(clamp(shadow_distance / 6.5, -10.0, 10.0))));

  float shape = coverage(distance, aa);
  composite(result, plate.rgb, plate.a * shape);
  composite(result, rim.rgb, rim.a * coverage(abs(distance) - 0.3, aa));

  if (glow > 0.01) {
    float reach = 34.0 + 20.0 * glow;
    float t = clamp(length(point) / reach, 0.0, 1.0);
    float strength = (dark ? 0.3 : 0.19) * 0.55 * min(1.0, glow);
    vec3 middle = mix(base.rgb, core.rgb, 0.5);
    composite(result, mix(middle, base.rgb, t), strength * (1.0 - t) * shape);
  }

  vec2 center_offset = vec2(float(columns) - 1.0, float(rows) - 1.0) * 0.5;
  int i0 = int(roundEven(point.x / pitch + center_offset.x));
  int j0 = int(roundEven(point.y / pitch + center_offset.y));
  float unlit = dark ? 0.07 : 0.085;
  float full = dark ? 0.96 : 1.0;
  float curve = dark ? 0.9 : 0.75;
  float presence = 0.5 + 0.5 * max(live, cool);
  for (int dj = -1; dj <= 1; dj++) {
    for (int di = -1; di <= 1; di++) {
      int i = i0 + di;
      int j = j0 + dj;
      if (i < 0 || j < 0 || i >= columns || j >= rows) {
        continue;
      }
      vec2 center = (vec2(float(i), float(j)) - center_offset) * pitch;
      float cap = -rounded_box(center, half_size, radius);
      float mask = sstep(1.4, 4.6, cap);
      if (mask <= 0.0) {
        continue;
      }
      vec2 value = texelFetch(dots, ivec2(i, j), 0).rg;
      float power = max(value.x, 1e-5);
      float fresh = value.y;
      float row = abs(center.y) / half_size.y;
      float floor_alpha = unlit * (1.0 - 0.7 * sstep(0.35, 0.95, row)) * presence * grid;
      float alpha = floor_alpha + (full - floor_alpha) * pow(power, curve * mix(1.4, 1.0, fresh));
      float dot_radius = (0.25 + 0.17 * pow(power, 0.6))
        * mix(1.0, mix(0.82, 1.0, fresh), sstep(0.03, 0.2, power)) * pitch;
      float core_mix = clamp(power * power * 1.1, 0.0, 0.9) * mix(0.3, 1.0, fresh);
      vec3 dot_color = mix(base.rgb, core.rgb, core_mix);
      float from_center = length(point - center);
      if (power > 0.05) {
        composite(result, dot_color,
          0.132 * power * power * mask * shape * coverage(from_center - dot_radius * 2.0, aa));
      }
      composite(result, dot_color, alpha * mask * shape * coverage(from_center - dot_radius, aa));
    }
  }

  result *= opacity;
  color = dithered(result, position);
}
`;
