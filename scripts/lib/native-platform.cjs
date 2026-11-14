/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native build configuration. */
function nativeTarget(platform, arch) {
  if (platform === 'win32' && arch === 'x64')
    return {
      platform,
      arch,
      triplet: 'x64-windows-audio',
      hostTriplet: 'x64-windows',
      profile: 'ffmpeg-profile.cmake'
    }
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch))
    return {
      platform,
      arch,
      triplet: `${arch}-osx-audio`,
      hostTriplet: `${process.arch === 'arm64' ? 'arm64' : 'x64'}-osx`,
      profile: 'ffmpeg-profile-macos.cmake',
      cmakeArch: arch === 'x64' ? 'x86_64' : 'arm64',
      deploymentTarget: '12.0'
    }
  throw new Error(
    `Unsupported native target: ${platform}/${arch}; build a single supported architecture first`
  )
}
module.exports = { nativeTarget }
