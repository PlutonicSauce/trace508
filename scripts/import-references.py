"""Import failure-category metadata from retained official W3C evaluation HTML.
No reference issue is inserted into scan Findings. IDs are page + criterion + failure category.
"""
from html.parser import HTMLParser
import json,re,hashlib,pathlib,zipfile,xml.etree.ElementTree as E
class Rows(HTMLParser):
 def __init__(self):super().__init__();self.rows=[];self.current=None;self.text=[];self.items=[];self.item=None
 def handle_starttag(self,tag,attrs):
  if tag=='tr':self.current=dict(attrs).get('class','');self.text=[];self.items=[]
  if tag=='li' and self.current is not None:self.item=[]
 def handle_data(self,data):
  if self.current is not None:self.text.append(data)
  if self.item is not None:self.item.append(data)
 def handle_endtag(self,tag):
  if tag=='li' and self.item is not None:self.items.append(' '.join(' '.join(self.item).split()));self.item=None
  if tag=='tr' and self.current is not None:self.rows.append((self.current,' '.join(' '.join(self.text).split()),self.items));self.current=None
records=[];sources=[]
for name in ['home','news','tickets','survey']:
 p=pathlib.Path('data/references/'+name+'.html');raw=p.read_bytes();parser=Rows();parser.feed(raw.decode());criterion=None
 source='https://www.w3.org/WAI/demos/bad/before/reports/'+name+'.html'
 sources.append(dict(page=name,url=source,sha256=hashlib.sha256(raw).hexdigest()))
 for cls,text,items in parser.rows:
  if cls.startswith('criterion'):
   m=re.match(r'(\d\.\d\.\d+)\s+(.*?)\s+.*?\(Level (A|AA|AAA)\)',text)
   criterion=(m.group(1),m.group(2),m.group(3)) if m and 'fail' in cls and m.group(3)!='AAA' else None
  elif cls.startswith('evaluation') and 'fail' in cls and criterion:
   failures=list(dict.fromkeys(re.findall(r'Failure (F\d+)',text)))
   if not failures or any(not re.search(r'Failure F\d+',item) for item in items):failures.append('narrative')
   for failure in failures:records.append(dict(id=f'{name}:{criterion[0]}:{failure}',page=name,criterion=criterion[0],failure=failure,source=source))
out={'version':'w3c-bad-2012-failure-categories-v2','retrieved':'2026-10-17','unit':'page × WCAG A/AA criterion × published failure category (not individual DOM instances)','sources':sources,'issues':records}
pathlib.Path('data/reference-issues.json').write_text(json.dumps(out,indent=2))
print('Imported',len(records),'reference failure-category units')
# Preserve all official chapter rows as a checklist, without claiming applicability.
with zipfile.ZipFile('data/references/VPAT-2.5Rev-508.docx') as z:
 root=E.fromstring(z.read('word/document.xml')); ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
 rows=[]
 for tr in root.findall('.//w:tr',ns):
  cells=tr.findall('w:tc',ns)
  if cells:
   label=' '.join(''.join(cells[0].itertext()).split()) if False else ' '.join(t.text or '' for t in cells[0].findall('.//w:t',ns))
   if re.match(r'^[3456]\d\d(?:\.|\s)',label):rows.append(label)
 pathlib.Path('data/vpat-chapters.json').write_text(json.dumps(list(dict.fromkeys(rows)),indent=2))
 print('Retained',len(rows),'Section 508 chapter checklist rows')
