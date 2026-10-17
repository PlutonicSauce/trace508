"""Independent verification: python3 scripts/verify-package.py evidence.zip [expected_archive_sha256]."""
import json,zipfile,hashlib,sys
raw=open(sys.argv[1],'rb').read()
if len(sys.argv)>2:assert hashlib.sha256(raw).hexdigest()==sys.argv[2],'Archive digest mismatch'
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 m=json.loads(z.read('manifest.json'))
 for f in m['files']:
  data=z.read(f['path']);assert len(data)==f['bytes'] and hashlib.sha256(data).hexdigest()==f['sha256'],f['path']+' was modified'
 print('Verified',len(m['files']),'content files. SHA-256:',hashlib.sha256(raw).hexdigest(),'(hash integrity, not a signature)')
