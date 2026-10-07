# T14 0.9.3 non-author merge

日期：2026-10-07

## Merge

- ROOT branch：`codex/dsh-router-v1`
- merge commit：`6fffd362d72f5befc7f1b03dc920866842c3d5d9`
- base：`14e2f56e2f07c5db8df3e03dfc621e4119604db2`
- author commit：`8cc67dd2259ee2fd20c3b427e69b6a7a317bec3f`
- method：`git merge --no-ff`

## Frozen package

- destination：`E:\GPT\Router项目\artifacts\irishwei-dsh-router-0.9.3.tgz`
- size：163149B
- SHA256：`AB78E7F703871EA6316A41A61BEE647E6C9184B627612BEB29BBAF7E56253DD3`
- copied with exclusive creation; existing files were never overwritten.

## Checks

- `npm run check`：pass。
- `npm run build`：pass。
- author and ROOT `lib/`：21 files each; CRLF-to-LF normalized comparison has 0 mismatches。
- `node --test --test-concurrency=1 test/*.test.mjs`：pass，290/290，0 failed，0 cancelled，0 skipped，exit code 0。
  - complete log：`C:\Users\a1500\AppData\Local\Temp\router-implementation\t14-v093-full-serial-20261007.log`
- Earlier T16 Windows `ENOTEMPTY` evidence remains preserved in prior reports; it did not occur in this run.

No push, issue close, Desktop/RPC operation, network change, credential/key access, bundle, or pack was performed.
