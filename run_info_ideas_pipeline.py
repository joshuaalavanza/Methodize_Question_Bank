from pathlib import Path
from ingestion.extract import extract_pages, vision_images, full_text, find_question_pages, save_question_crops
from ingestion.structure import structure_pdf
import json

pdf_path = Path('data/pdfs/hard information and ideas.pdf')

# Extract pages
print('Extracting pages from PDF...')
pages = extract_pages(pdf_path)
print(f'Extracted {len(pages)} pages')

# Get text and images
raw_text = full_text(pages)
page_images = vision_images(pdf_path)

# Structure with Claude
print('Structuring questions with Claude...')
questions = structure_pdf(raw_text, domain='Information and Ideas', page_images=page_images)
print(f'Extracted {len(questions)} questions')

# Map question IDs to pages for cropping
question_page_map = find_question_pages(pages)
print(f'Mapped {len(question_page_map)} questions to pages')

# Save cropped images
print('Saving cropped question images...')
output_dir = Path('data/structured/images/information_and_ideas')
image_map = save_question_crops(pdf_path, question_page_map, output_dir)
print(f'Saved {len(image_map)} cropped images')

# Save questions to JSONL with image paths
for q in questions:
    qid = q['id']
    if qid in image_map:
        img_fname = image_map[qid]
        q['image_path'] = 'information_and_ideas/' + img_fname
    else:
        q['image_path'] = ''
    q['embedding'] = []

jsonl_path = Path('data/structured/hard_information_and_ideas.jsonl')
with open(jsonl_path, 'w') as f:
    for q in questions:
        f.write(json.dumps(q) + '\n')

print(f'Saved {len(questions)} questions to {jsonl_path.name}')
