from chromadb import PersistentClient

client = PersistentClient(path='data/chroma')
col = client.get_collection('sat_questions')

# Get all questions
results = col.get(include=['metadatas'])

# Group by domain
domains = {}
for meta in results['metadatas']:
    domain = meta['domain']
    skill = meta['skill']
    if domain not in domains:
        domains[domain] = {}
    if skill not in domains[domain]:
        domains[domain][skill] = 0
    domains[domain][skill] += 1

print('All skills by domain:')
for domain in sorted(domains.keys()):
    print(f'\n{domain}:')
    for skill in sorted(domains[domain].keys()):
        count = domains[domain][skill]
        print(f'  {skill}: {count}')
