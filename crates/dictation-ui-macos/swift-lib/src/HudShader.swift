import simd

/// `HudUniforms` in `hudShaderSource`: eight float4s, 128 bytes.
struct HudUniforms {
  /// resolution (device px), backing scale, span (pt)
  var metrics0: SIMD4<Float>
  /// plate width, height, opacity, scale
  var metrics1: SIMD4<Float>
  /// softness, samples, line width (pt), corner radius
  var metrics2: SIMD4<Float>
  var line: SIMD4<Float>
  var light: SIMD4<Float>
  var plate: SIMD4<Float>
  var rim: SIMD4<Float>
  var shadow: SIMD4<Float>
}

/// The scope's plate and its two traces as anti-aliased strokes, in Metal.
/// The plate follows Hex's `src/rune_hud.wgsl` (MIT, © 2026 Christopher
/// Langton) without the notch island. Compiled at runtime
/// (`MTLDevice.makeLibrary(source:)`). Positions are in points from the
/// view's middle, y down; colours are sRGB-encoded and premultiplied. The
/// Windows and Linux HUD draws the same shader in GLSL
/// (`apps/desktop/src/dictation/hud/shader.ts`).
let hudShaderSource = """
  #include <metal_stdlib>
  using namespace metal;

  struct Varyings {
    float4 position [[position]];
    float2 uv;
  };

  struct HudUniforms {
    float4 metrics0;
    float4 metrics1;
    float4 metrics2;
    float4 line;
    float4 light;
    float4 plate;
    float4 rim;
    float4 shadow;
  };

  static_assert(sizeof(HudUniforms) == 128, "HudUniforms must match Swift");

  vertex Varyings hud_vertex(uint vertex_id [[vertex_id]]) {
    const float2 positions[3] = { float2(-1.0, -1.0), float2(3.0, -1.0), float2(-1.0, 3.0) };
    float2 p = positions[vertex_id];
    Varyings out;
    out.position = float4(p, 0.0, 1.0);
    out.uv = float2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    return out;
  }

  static float sstep(float edge0, float edge1, float x) {
    float t = clamp((x - edge0) / (edge1 - edge0), 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
  }

  static float rounded_box(float2 point, float2 half_size, float radius) {
    float2 q = abs(point) - half_size + radius;
    return length(max(q, float2(0.0f))) + min(max(q.x, q.y), 0.0f) - radius;
  }

  static float coverage(float distance, float softness) {
    return sstep(softness, -softness, distance);
  }

  static void composite(thread float4 &destination, float3 color, float alpha_in) {
    float alpha = clamp(alpha_in, 0.0f, 1.0f);
    destination = float4(
      color * alpha + destination.rgb * (1.0f - alpha),
      alpha + destination.a * (1.0f - alpha));
  }

  fragment float4 hud_fragment(
    Varyings in [[stage_in]],
    constant HudUniforms &u [[buffer(0)]],
    constant float2 *lines [[buffer(1)]]
  ) {
    float2 resolution = u.metrics0.xy;
    float backing_scale = u.metrics0.z;
    float span = u.metrics0.w;
    float width = u.metrics1.x;
    float height = u.metrics1.y;
    float opacity = u.metrics1.z;
    float scale = max(u.metrics1.w, 0.001f);
    float softness = max(u.metrics2.x, 0.0f);
    int samples = int(u.metrics2.y + 0.5f);
    float line_width = u.metrics2.z;

    float2 position = in.uv * resolution;
    float2 window_point = (position - resolution * 0.5f) / backing_scale;
    float2 point = window_point / scale;
    float pixel = 1.0f / (backing_scale * scale);
    float aa = pixel * 0.75f + softness * 0.72f;
    float2 half_size = float2(width, height) * 0.5f;
    float radius = clamp(u.metrics2.w, 0.0f, height * 0.5f);
    float distance = rounded_box(point, half_size, radius);
    float4 result = float4(0.0f);

    // A soft drop shadow 4 pt below.
    float shadow_distance = rounded_box(point - float2(0.0f, 4.0f), half_size, radius);
    composite(result, u.shadow.rgb,
      u.shadow.a * (0.5f - 0.5f * precise::tanh(clamp(shadow_distance / 7.0f, -10.0f, 10.0f))));

    float shape = coverage(distance, aa);
    composite(result, u.plate.rgb, u.plate.a * shape);
    composite(result, u.rim.rgb, u.rim.a * coverage(abs(distance) - 0.25f, aa));

    // The strokes thin out before the plate's edge.
    float inside = shape * sstep(2.0f, 7.0f, -distance);
    if (inside > 0.0f) {
      float step_x = 2.0f * span / float(samples - 1);
      int nearest = int(floor((point.x + span) / step_x));
      // The back trace first, a little thinner and fainter.
      for (int k = 1; k >= 0; k--) {
        float best = 1e9f;
        float intensity = 0.0f;
        for (int s = nearest - 3; s <= nearest + 3; s++) {
          if (s < 0 || s + 1 >= samples) {
            continue;
          }
          float2 a_value = lines[k * samples + s];
          float2 b_value = lines[k * samples + s + 1];
          float2 a = float2(-span + float(s) * step_x, a_value.x);
          float2 ab = float2(step_x, b_value.x - a_value.x);
          float t = clamp(dot(point - a, ab) / dot(ab, ab), 0.0f, 1.0f);
          float d = length(point - a - ab * t);
          if (d < best) {
            best = d;
            intensity = mix(a_value.y, b_value.y, t);
          }
        }
        float half_width = line_width * (k == 0 ? 0.5f : 0.4f);
        float strength = k == 0 ? 1.0f : 0.5f;
        float alpha = min(intensity, 1.0f) * strength * inside * coverage(best - half_width, aa);
        composite(result, mix(u.line.rgb, u.light.rgb, sstep(0.5f, 1.1f, intensity)), alpha);
      }
    }

    return result * opacity;
  }
  """
