set(VCPKG_TARGET_ARCHITECTURE x64)
set(VCPKG_CRT_LINKAGE dynamic)
set(VCPKG_LIBRARY_LINKAGE dynamic)
set(VCPKG_BUILD_TYPE release)
# PNG artwork needs zlib; link it into FFmpeg rather than ship another DLL.
if(PORT STREQUAL "zlib")
    set(VCPKG_LIBRARY_LINKAGE static)
endif()
