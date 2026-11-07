// The scope's plate and its two traces as anti-aliased strokes, in GLSL ES
// 3.0. The plate follows Hex's `src/rune_hud.wgsl` (MIT, © 2026 Christopher
// Langton) without the notch island. Positions are in points from the
// canvas's middle, y down; colours are sRGB-encoded and premultiplied. The
// macOS HUD draws the same shader in Metal (`crates/dictation-ui-macos`).

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

// x, y: resolution (device px), z: backing scale, w: span (pt)
uniform vec4 metrics0;
// plate width, height, opacity, scale
uniform vec4 metrics1;
// softness, samples, line width (pt), corner radius
uniform vec4 metrics2;
uniform vec4 line;
uniform vec4 light;
uniform vec4 plate;
uniform vec4 rim;
uniform vec4 shadow;
// Each trace sample's (y, intensity) at (sample, trace).
uniform sampler2D lines;

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

void main() {
  vec2 resolution = metrics0.xy;
  float backing_scale = metrics0.z;
  float span = metrics0.w;
  float width = metrics1.x;
  float height = metrics1.y;
  float opacity = metrics1.z;
  float scale = max(metrics1.w, 0.001);
  float softness = max(metrics2.x, 0.0);
  int samples = int(metrics2.y + 0.5);
  float line_width = metrics2.z;

  vec2 position = uv * resolution;
  vec2 window_point = (position - resolution * 0.5) / backing_scale;
  vec2 point = window_point / scale;
  float pixel = 1.0 / (backing_scale * scale);
  float aa = pixel * 0.75 + softness * 0.72;
  vec2 half_size = vec2(width, height) * 0.5;
  float radius = clamp(metrics2.w, 0.0, height * 0.5);
  float distance = rounded_box(point, half_size, radius);
  vec4 result = vec4(0.0);

  // A soft drop shadow 4 pt below.
  float shadow_distance = rounded_box(point - vec2(0.0, 4.0), half_size, radius);
  composite(result, shadow.rgb, shadow.a * (0.5 - 0.5 * tanh(clamp(shadow_distance / 7.0, -10.0, 10.0))));

  float shape = coverage(distance, aa);
  composite(result, plate.rgb, plate.a * shape);
  composite(result, rim.rgb, rim.a * coverage(abs(distance) - 0.25, aa));

  // The strokes thin out before the plate's edge.
  float inside = shape * sstep(2.0, 7.0, -distance);
  if (inside > 0.0) {
    float step_x = 2.0 * span / float(samples - 1);
    int nearest = int(floor((point.x + span) / step_x));
    // The back trace first, a little thinner and fainter.
    for (int k = 1; k >= 0; k--) {
      float best = 1e9;
      float intensity = 0.0;
      for (int s = nearest - 3; s <= nearest + 3; s++) {
        if (s < 0 || s + 1 >= samples) {
          continue;
        }
        vec2 a_value = texelFetch(lines, ivec2(s, k), 0).rg;
        vec2 b_value = texelFetch(lines, ivec2(s + 1, k), 0).rg;
        vec2 a = vec2(-span + float(s) * step_x, a_value.x);
        vec2 ab = vec2(step_x, b_value.x - a_value.x);
        float t = clamp(dot(point - a, ab) / dot(ab, ab), 0.0, 1.0);
        float d = length(point - a - ab * t);
        if (d < best) {
          best = d;
          intensity = mix(a_value.y, b_value.y, t);
        }
      }
      float half_width = line_width * (k == 0 ? 0.5 : 0.4);
      float strength = k == 0 ? 1.0 : 0.5;
      float alpha = min(intensity, 1.0) * strength * inside * coverage(best - half_width, aa);
      composite(result, mix(line.rgb, light.rgb, sstep(0.5, 1.1, intensity)), alpha);
    }
  }

  color = result * opacity;
}
`;
