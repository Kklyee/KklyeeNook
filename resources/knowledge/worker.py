import contextlib
import json
import sys
import traceback

models = {}
converter = None


def run(request):
    global converter
    action = request["action"]
    if action == "parse":
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions

        if converter is None:
            options = PdfPipelineOptions()
            options.do_ocr = True
            options.do_table_structure = True
            options.ocr_options = RapidOcrOptions()
            converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})
        result = converter.convert(request["path"])
        if result.status.value not in ("success", "partial_success"):
            raise RuntimeError(f"Docling conversion failed: {result.status.value}")
        if result.status.value == "partial_success":
            raise RuntimeError(f"Docling conversion incomplete: {result.errors}")
        doc = result.document
        blocks = []
        for item, depth in doc.iterate_items():
            label = item.label.value
            if label in ("page_header", "page_footer"):
                continue
            if label == "table":
                content = item.export_to_markdown(doc=doc)
                kind = "table"
            elif hasattr(item, "text"):
                content = item.text
                kind = "heading" if label in ("title", "section_header") else "code" if label == "code" else "paragraph"
            else:
                continue
            if not content.strip():
                continue
            pages = sorted({prov.page_no for prov in item.prov})
            block = {"kind": kind, "content": content, "metadata": {"label": label, "provenance": [prov.model_dump(mode="json") for prov in item.prov]}}
            if kind == "heading":
                block["level"] = getattr(item, "level", 1 if label == "title" else max(1, depth))
            if pages:
                block["page"] = pages[0]
                block["pageEnd"] = pages[-1]
            blocks.append(block)
        return {"title": doc.name, "blocks": blocks, "pages": sorted(int(page) for page in doc.pages), "metadata": {"parser": "docling", "schemaVersion": doc.version}}
    if action == "embed":
        from sentence_transformers import SentenceTransformer

        key = (action, request["model"])
        if key not in models:
            models[key] = SentenceTransformer(request["model"], device="cpu", trust_remote_code=False)
            models[key].max_seq_length = min(512, models[key].get_max_seq_length())
        return models[key].encode(request["texts"], normalize_embeddings=True, batch_size=16, show_progress_bar=False).tolist()
    if action == "rerank":
        from sentence_transformers import CrossEncoder

        key = (action, request["model"])
        if key not in models:
            models[key] = CrossEncoder(request["model"], device="cpu", max_length=512, trust_remote_code=False)
        return models[key].predict([[request["query"], text] for text in request["texts"]], batch_size=8, show_progress_bar=False).tolist()
    raise ValueError(f"Unknown knowledge action: {action}")


for line in sys.stdin:
    request = json.loads(line)
    try:
        with contextlib.redirect_stdout(sys.stderr):
            value = run(request)
        response = {"id": request["id"], "value": value}
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        response = {"id": request["id"], "error": str(error)}
    print(json.dumps(response, ensure_ascii=False), flush=True)
