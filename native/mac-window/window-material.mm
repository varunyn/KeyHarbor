#import <AppKit/AppKit.h>
#include <node_api.h>
#include <cstring>

// A backdrop must never participate in Chromium's mouse or keyboard handling.
@interface KeyHarborGlassBackdrop : NSView
@end
@implementation KeyHarborGlassBackdrop
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (BOOL)acceptsFirstResponder { return NO; }
@end

static napi_value UpdateMaterial(napi_env env, napi_callback_info info) {
  size_t count = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  bool isBuffer = false;
  bool enabled = false;
  bool dark = false;
  void *bytes = nullptr;
  size_t length = 0;
  if (count != 3 || napi_is_buffer(env, args[0], &isBuffer) != napi_ok || !isBuffer ||
      napi_get_buffer_info(env, args[0], &bytes, &length) != napi_ok || length != sizeof(void *) ||
      napi_get_value_bool(env, args[1], &enabled) != napi_ok ||
      napi_get_value_bool(env, args[2], &dark) != napi_ok || ![NSThread isMainThread]) {
    napi_throw_type_error(env, nullptr, "Expected a native window handle, material flag, and appearance flag on the main thread");
    return nullptr;
  }
  void *pointer = nullptr;
  std::memcpy(&pointer, bytes, sizeof(pointer));
  NSView *content = (__bridge NSView *)pointer;
  // Stay inside Electron's content container; drawing in NSThemeFrame can
  // retain stale Chromium frames when the web surface becomes transparent.
  NSView *parent = content;
  BOOL attached = NO;
  if (parent && content.window) {
    content.window.appearance = [NSAppearance appearanceNamed:
      dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
    for (NSView *sibling in [parent.subviews copy]) {
      if ([sibling.identifier isEqualToString:@"keyharbor-native-glass"]) {
        [sibling removeFromSuperview];
      }
    }
#if __has_include(<AppKit/NSGlassEffectView.h>)
    if (@available(macOS 26.0, *)) {
      NSWorkspace *workspace = NSWorkspace.sharedWorkspace;
      if (enabled && !workspace.accessibilityDisplayShouldReduceTransparency &&
          !workspace.accessibilityDisplayShouldIncreaseContrast) {
        KeyHarborGlassBackdrop *glass = [[KeyHarborGlassBackdrop alloc] initWithFrame:content.bounds];
        glass.identifier = @"keyharbor-native-glass";
        glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        NSGlassEffectView *effect = [[NSGlassEffectView alloc] initWithFrame:glass.bounds];
        effect.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        effect.style = NSGlassEffectViewStyleRegular;
        effect.cornerRadius = 0;
        [effect setAccessibilityElement:NO];
        [glass setAccessibilityElement:NO];
        [glass addSubview:effect];
        [parent addSubview:glass positioned:NSWindowBelow relativeTo:nil];
        content.window.opaque = NO;
        content.window.backgroundColor = NSColor.clearColor;
        attached = YES;
      }
    }
#endif
  }
  napi_value result;
  napi_get_boolean(env, attached, &result);
  return result;
}

NAPI_MODULE_INIT() {
  napi_value update;
  napi_create_function(env, "updateMaterial", NAPI_AUTO_LENGTH, UpdateMaterial, nullptr, &update);
  napi_set_named_property(env, exports, "updateMaterial", update);
  return exports;
}
