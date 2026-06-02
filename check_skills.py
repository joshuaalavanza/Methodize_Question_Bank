from chromadb import PersistentClient

client = PersistentClient(path='data/chroma')
col = client.get_collection('sat_questions')

# Get all Information and Ideas questions
results = col.get(
    where={'domain': {'$eq': 'Information and Ideas'}},
    include=['metadatas']
)

# Get unique skills
skills = {}
for meta in results['metadatas']:
    skill = meta['skill']
    if skill not in skills:
        skills[skill] = 0
    skills[skill] += 1

print('Skills in Information and Ideas domain:')
for skill in sorted(skills.keys()):
    print(f'  {skill}: {skills[skill]} questions')
