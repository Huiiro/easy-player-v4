use std::{
    ffi::{CString, c_char, c_void},
    path::Path,
    ptr::NonNull,
};

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Snapshot {
    pub position_ms: f64,
    pub duration_ms: f64,
    playing: i32,
    stopped: i32,
    pub glitches: i32,
}

impl Snapshot {
    pub fn playing(self) -> bool {
        self.playing != 0
    }

    pub fn stopped(self) -> bool {
        self.stopped != 0
    }
}

unsafe extern "C" {
    fn ep_create(volume: f32) -> *mut c_void;
    fn ep_destroy(engine: *mut c_void);
    fn ep_open(engine: *mut c_void, path: *const c_char) -> i32;
    fn ep_set_playing(engine: *mut c_void, playing: i32) -> i32;
    fn ep_seek(engine: *mut c_void, ms: f64) -> i32;
    fn ep_snapshot(engine: *mut c_void, snapshot: *mut Snapshot, service_device: i32);
}

pub struct Audio(NonNull<c_void>);

// The owner lives on the UI thread. C++ owns the decoder and output threads.
impl Audio {
    pub fn new(volume: f32) -> Option<Self> {
        NonNull::new(unsafe { ep_create(volume) }).map(Self)
    }

    pub fn open(&self, path: &Path) -> bool {
        let Some(path) = path.to_str().and_then(|text| CString::new(text).ok()) else {
            return false;
        };
        unsafe { ep_open(self.0.as_ptr(), path.as_ptr()) != 0 }
    }

    pub fn set_playing(&self, playing: bool) -> bool {
        unsafe { ep_set_playing(self.0.as_ptr(), i32::from(playing)) != 0 }
    }

    pub fn seek(&self, ms: f64) -> bool {
        unsafe { ep_seek(self.0.as_ptr(), ms) != 0 }
    }

    pub fn snapshot(&self, service_device: bool) -> Snapshot {
        let mut snapshot = Snapshot::default();
        unsafe { ep_snapshot(self.0.as_ptr(), &mut snapshot, i32::from(service_device)) };
        snapshot
    }
}

impl Drop for Audio {
    fn drop(&mut self) {
        unsafe { ep_destroy(self.0.as_ptr()) }
    }
}
