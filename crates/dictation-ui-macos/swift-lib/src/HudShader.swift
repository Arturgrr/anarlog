import simd

/// `HudUniforms` in `hudShaderSource`: nine float4s, 144 bytes.
struct HudUniforms {
  /// resolution (device px), backing scale, dot pitch (pt)
  var metrics0: SIMD4<Float>
  /// plate width, height, opacity, scale
  var metrics1: SIMD4<Float>
  /// softness, columns, rows, corner radius
  var metrics2: SIMD4<Float>
  /// glow, grid, live, cool
  var state: SIMD4<Float>
  /// rgb, w: 1 in the dark appearance
  var base: SIMD4<Float>
  var core: SIMD4<Float>
  var plate: SIMD4<Float>
  var rim: SIMD4<Float>
  var shadow: SIMD4<Float>
}

/// Dot scope's plate, glow and dots: Hex's `src/rune_hud.wgsl`
/// (`dot_scope_fragment`, MIT, © 2026 Christopher Langton) in Metal, without
/// the notch island. Compiled at runtime (`MTLDevice.makeLibrary(source:)`).
/// Positions are in points from the view's middle, y down; colours are
/// sRGB-encoded and premultiplied.
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
    float4 state;
    float4 base;
    float4 core;
    float4 plate;
    float4 rim;
    float4 shadow;
  };

  static_assert(sizeof(HudUniforms) == 144, "HudUniforms must match Swift");

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

  static float4 dithered(float4 result_in, float2 position) {
    float4 result = result_in;
    if (result.a > 0.0f) {
      float2 pixel = floor(position);
      float n1 = fract(52.9829189f * fract(dot(pixel, float2(0.06711056f, 0.00583715f))));
      float n2 = fract(
        52.9829189f * fract(dot(pixel + float2(17.0f, 31.0f), float2(0.06711056f, 0.00583715f))));
      float dither = ((n1 - n2) / 255.0f) * result.a;
      result = float4(clamp(result.rgb + float3(dither), float3(0.0f), float3(result.a)), result.a);
    }
    return result;
  }

  fragment float4 hud_fragment(
    Varyings in [[stage_in]],
    constant HudUniforms &u [[buffer(0)]],
    constant ushort2 *dots [[buffer(1)]]
  ) {
    float2 resolution = u.metrics0.xy;
    float backing_scale = u.metrics0.z;
    float pitch = u.metrics0.w;
    float width = u.metrics1.x;
    float height = u.metrics1.y;
    float opacity = u.metrics1.z;
    float scale = max(u.metrics1.w, 0.001f);
    float softness = max(u.metrics2.x, 0.0f);
    int columns = int(u.metrics2.y + 0.5f);
    int rows = int(u.metrics2.z + 0.5f);
    float glow = u.state.x;
    float grid = u.state.y;
    float live = u.state.z;
    float cool = u.state.w;
    bool dark = u.base.w > 0.5f;

    float2 position = in.uv * resolution;
    float2 window_point = (position - resolution * 0.5f) / backing_scale;
    float2 point = window_point / scale;
    float pixel = 1.0f / (backing_scale * scale);
    float aa = pixel * 0.75f + softness * 0.72f;
    float2 half_size = float2(width, height) * 0.5f;
    float radius = clamp(u.metrics2.w, 0.0f, height * 0.5f);
    float distance = rounded_box(point, half_size, radius);
    float4 result = float4(0.0f);

    // A soft drop shadow 3 pt below.
    float shadow_distance = rounded_box(point - float2(0.0f, 3.0f), half_size, radius);
    composite(result, u.shadow.rgb,
      u.shadow.a * (0.5f - 0.5f * precise::tanh(clamp(shadow_distance / 6.5f, -10.0f, 10.0f))));

    float shape = coverage(distance, aa);
    composite(result, u.plate.rgb, u.plate.a * shape);
    composite(result, u.rim.rgb, u.rim.a * coverage(abs(distance) - 0.3f, aa));

    if (glow > 0.01f) {
      float reach = 34.0f + 20.0f * glow;
      float t = clamp(length(point) / reach, 0.0f, 1.0f);
      float strength = (dark ? 0.3f : 0.19f) * 0.55f * min(1.0f, glow);
      float3 middle = mix(u.base.rgb, u.core.rgb, 0.5f);
      composite(result, mix(middle, u.base.rgb, t), strength * (1.0f - t) * shape);
    }

    float2 center_offset = float2(float(columns) - 1.0f, float(rows) - 1.0f) * 0.5f;
    int i0 = int(rint(point.x / pitch + center_offset.x));
    int j0 = int(rint(point.y / pitch + center_offset.y));
    float unlit = dark ? 0.07f : 0.085f;
    float full = dark ? 0.96f : 1.0f;
    float curve = dark ? 0.9f : 0.75f;
    float presence = 0.5f + 0.5f * max(live, cool);
    for (int dj = -1; dj <= 1; dj++) {
      for (int di = -1; di <= 1; di++) {
        int i = i0 + di;
        int j = j0 + dj;
        if (i < 0 || j < 0 || i >= columns || j >= rows) {
          continue;
        }
        float2 center = (float2(float(i), float(j)) - center_offset) * pitch;
        float cap = -rounded_box(center, half_size, radius);
        float mask = sstep(1.4f, 4.6f, cap);
        if (mask <= 0.0f) {
          continue;
        }
        float2 value = float2(dots[j * columns + i]) / 65535.0f;
        float power = max(value.x, 1e-5f);
        float fresh = value.y;
        float row = abs(center.y) / half_size.y;
        float floor_alpha = unlit * (1.0f - 0.7f * sstep(0.35f, 0.95f, row)) * presence * grid;
        float alpha = floor_alpha + (full - floor_alpha) * pow(power, curve * mix(1.4f, 1.0f, fresh));
        float dot_radius = (0.25f + 0.17f * pow(power, 0.6f))
          * mix(1.0f, mix(0.82f, 1.0f, fresh), sstep(0.03f, 0.2f, power)) * pitch;
        float core = clamp(power * power * 1.1f, 0.0f, 0.9f) * mix(0.3f, 1.0f, fresh);
        float3 color = mix(u.base.rgb, u.core.rgb, core);
        float from_center = length(point - center);
        if (power > 0.05f) {
          composite(result, color,
            0.132f * power * power * mask * shape * coverage(from_center - dot_radius * 2.0f, aa));
        }
        composite(result, color, alpha * mask * shape * coverage(from_center - dot_radius, aa));
      }
    }

    result *= opacity;
    return dithered(result, position);
  }
  """
