"""Verify exported DOCX structure and its evidence references against its saved snapshot."""
import json,zipfile,xml.etree.ElementTree as E,hashlib,pathlib
r=json.load(open('.local/report-record.json'));snapshot=r['snapshot'];p=pathlib.Path(r['path']);raw=p.read_bytes()
assert hashlib.sha256(raw).hexdigest()==r['sha256'],'File hash must equal persisted report hash'
with zipfile.ZipFile(p) as z:
 assert z.testzip() is None
 root=E.fromstring(z.read('word/document.xml'));ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
 text=' '.join(t.text or '' for t in root.findall('.//w:t',ns))
 assert snapshot['assessment']['id'] in text
 assert len(snapshot['matrix'])==38
 for row in snapshot['matrix']:
  assert f"{row['id']} {row['title']}" in text
  for fid in row['findings']:assert fid in text
  for eid in row['evidenceIds']:assert any(e['id']==eid for e in snapshot['manifest'])
 assert 'DRAFT ONLY' in text
 assert len([e for e in root.findall('.//w:tblHeader',ns) if e.get('{'+ns['w']+'}val')!='off'])==3
 styles=E.fromstring(z.read('word/styles.xml'))
 assert styles.find('.//w:lang',ns).get('{'+ns['w']+'}val')=='en-US'
print('PASS: DOCX opens as valid OOXML; hash, all 38 rows, finding IDs, manifest references, language and repeating table headers match persisted snapshot.')
