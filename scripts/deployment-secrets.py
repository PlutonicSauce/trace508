"""Generate local deployment secrets once; never print passwords or URLs."""
import os,pathlib,secrets
p=pathlib.Path(os.environ.get('SECRETS_DIR','.local/secrets'))
p.mkdir(parents=True,exist_ok=True,mode=0o700)
os.chmod(p,0o700)
password=secrets.token_hex(32)
for name,value in [('db_password',password),('database_url',f'postgresql://trace508:{password}@db:5432/trace508')]:
 with open(p/name,'x') as f:
  os.chmod(p/name,0o644);f.write(value+'\n')
print('Created protected database secrets. No credentials printed. Preserve them in your approved secret store.')
