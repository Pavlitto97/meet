{
  "task": "generate_one_horizontal_collage_of_two_webcam_frames",
  "version": 4,

  "input": {
    "reference_photo_count": 1,
    "instructions": "Use the single uploaded photo as the ONLY identity reference. Do not invent additional subjects."
  },

  "output": {
    "image_count": 1,
    "layout": "single_horizontal_collage_two_frames_side_by_side",
    "frames": {
      "count": 2,
      "left_frame": "meeting_start_moment",
      "right_frame": "meeting_end_moment",
      "vertical_split": "NONE",
      "grid_2x2": "FORBIDDEN",
      "stacking": "FORBIDDEN"
    },
    "aspect_ratio": "16:9",
    "background_rules": {
      "edge_to_edge": true,
      "no_white_padding": true,
      "no_white_borders": true,
      "no_empty_canvas_space": true,
      "between_frames_gap": "0px (no white gutter, no separator line)",
      "around_collage": "0px (frames fill the canvas to the edges)"
    },
    "ui_text_rules": {
      "captions": "none",
      "labels": "none",
      "timestamps_or_clock_overlay": "none",
      "frame_titles_like_Time_1_Time_2": "FORBIDDEN",
      "watermarks": "none",
      "app_logos_or_meeting_UI": "FORBIDDEN"
    }
  },

  "scene_consistency": {
    "context": "Same person during a single live online lecture (Zoom / Google Meet / Microsoft Teams). Two frames captured at different moments within ONE continuous session.",
    "must_remain_identical_across_both_frames": [
      "same room / environment",
      "same lighting conditions",
      "same camera device and perspective",
      "same general composition and crop style"
    ],
    "may_differ_between_frames": [
      "slight head tilt change",
      "small posture shift",
      "subtle gaze direction change",
      "minor repositioning in frame"
    ]
  },

  "camera": {
    "perspective_lock": "first_person_device_front_camera_only",
    "forbidden": [
      "third-person perspective",
      "external observer in the room",
      "over-the-shoulder shots",
      "cinematic room photography angles",
      "external camera viewpoint of the scene",
      "photo of a screen (phone/laptop/tablet/monitor)",
      "reflections of screens being photographed",
      "bezels, borders, or display edges",
      "moiré or screen-capture artifacts"
    ]
  },

  "style_lock": {
    "must_look_like": "raw imperfect live video call frame, low-resolution webcam output",
    "forbidden_styles": [
      "studio lighting",
      "DSLR portrait quality",
      "cinematic lighting",
      "beauty lighting",
      "Instagram-style aesthetic portraits",
      "perfectly balanced professional exposure",
      "ultra sharp headshot photography look",
      "professional photography aesthetic"
    ]
  },

  "imperfection_requirements_per_frame": [
    "low-resolution webcam quality",
    "compression artifacts",
    "slight blur or softness",
    "autofocus instability",
    "uneven indoor lighting",
    "screen light on face",
    "low dynamic range",
    "mild sensor noise / grain",
    "slight motion blur",
    "consumer-grade camera quality"
  ],

  "randomization_between_frames": {
    "head_tilt": "vary left / right / neutral",
    "face_direction": "toward screen vs. slightly off-center",
    "framing": "tight / wide / off-center / imperfect crop",
    "camera_angle": "slightly above / eye level / slightly below",
    "exposure": "bright / dark / uneven",
    "autofocus": "sharp / soft / slightly blurred",
    "goal": "each frame feels like a different live moment from the same session"
  },

  "identity_and_face_rules": {
    "preserve_identity_from_uploaded_photo": true,
    "natural_asymmetry": "allowed",
    "expression": "candid only, never posed",
    "upper_body_visible": true,
    "centered_or_posed": false
  },

  "background_rules": {
    "environment_type": "real indoor (bedroom, dorm, apartment, classroom)",
    "natural_imperfections": "allowed",
    "non_staged": true
  },

  "final_summary_for_the_model": "Produce EXACTLY ONE image. That image is a horizontal 2-frame collage that fills the canvas edge-to-edge in 16:9 aspect ratio. Left half = the same person at the start of the meeting, right half = the same person at the end of the meeting, in the same room. ZERO white padding, ZERO borders, ZERO captions, ZERO timestamps. Each frame looks like an ugly low-quality webcam still from a real video call."
}
