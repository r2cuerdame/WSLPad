# v1.2.0 private candidate evidence

The original candidate was built from `c06b065d5bd4127fdce32b115677494761782a64` and remains in private [draft release 405268106](https://github.com/r2cuerdame/WSLPad/releases/tag/untagged-e7ae35aa2178c70e891e). [manifest.json](manifest.json) records the installer, blockmap and `latest.yml` asset IDs, sizes and SHA256 values, plus the installer's SHA512 from `latest.yml`.

| Asset | Size | SHA256 |
| --- | --- | --- |
| `WSLPad-Setup-1.2.0.exe` | 88109909 | `f3b0c5110bb80f141e4c416a6b932ad5f92182f48dcaae7efeb3e9967f943b88` |
| `WSLPad-Setup-1.2.0.exe.blockmap` | 90194 | `1d259f770fbb8ae627a1b96a1050394368daf7989953d70fa8584be0842d2e4a` |
| `latest.yml` | 340 | `c1dee6aae0fedb26414360b453407d51b76dec96c2c0fca71b3ed9978fd42e69` |

Installer SHA512 (`latest.yml`): `c+zB9KYBlsX+D354etSLKU3MRVzkuRO50c4H36KpQws4UkLsQWZoAmM6ia2Oded+AzCXwLVcO0KYbR/aThnOAg==`

Public v1.1.2 and candidate installers are both Authenticode `NotSigned`. `electron-builder.yml` has no signing or certificate configuration. The previous publish method is unknown.

On 2026-11-03 the draft was still `draft: true` at the same target commit and asset IDs. Freshly downloaded bytes matched every size, SHA256 and SHA512 above, and public `releases/latest` was `v1.1.2`. No asset was replaced or published.

## Lifecycle status

**Not run (0/4 stages): Get-VM permission not yet in effect.** The owner approved a new clean Windows 11 Hyper-V VM on the home PC, with the isolated account only inside that VM. `recue` is listed in `Hyper-V Administrators`, but the current session token does not include that group, and `Get-VM` returns `이 작업을 완료하는 데 필요한 권한이 없습니다`. No VM, account, installer or user data was touched. The historical GitHub-hosted run 37701562990 does not qualify. Independent QA has not run, and no QA PASS is claimed.
