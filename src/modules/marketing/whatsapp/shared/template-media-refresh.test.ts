// An image Meta has forgotten (uploads last ~30 days) is rebuilt from the template's sample; a fine one is left alone; a passing
// Meta outage never causes a pointless re-upload.
const isMediaAlive = jest.fn();
const getTemplateHeaderExample = jest.fn();
const getTemplateCarouselExamples = jest.fn();
const uploadMedia = jest.fn();
jest.mock('./whatsapp.api', () => ({ whatsappMetaApi: {
  isMediaAlive: (...a: unknown[]) => isMediaAlive(...a),
  getTemplateHeaderExample: (...a: unknown[]) => getTemplateHeaderExample(...a),
  getTemplateCarouselExamples: (...a: unknown[]) => getTemplateCarouselExamples(...a),
  uploadMedia: (...a: unknown[]) => uploadMedia(...a),
} }));
const updateMediaId = jest.fn();
const updateCarousel = jest.fn();
jest.mock('../templates/templates.repository', () => ({ templatesRepository: {
  updateMediaId: (...a: unknown[]) => updateMediaId(...a),
  updateCarousel: (...a: unknown[]) => updateCarousel(...a),
} }));

import { ensureTemplateMediaFresh, MediaRefreshError, resetMediaRefreshMemory } from './template-media-refresh';

const CFG = { phone_number_id: 'pn1', access_token: 'tok' };
const sample = { buffer: Buffer.from('img'), mimeType: 'image/jpeg' };
const image = (over: object = {}) => ({ id: 't1', salon_id: 's1', meta_template_id: 'meta-1', header_type: 'image', header_media_id: 'old-id', carousel: null, ...over });

beforeEach(() => {
  [isMediaAlive, getTemplateHeaderExample, getTemplateCarouselExamples, uploadMedia, updateMediaId, updateCarousel].forEach((m) => m.mockReset());
  resetMediaRefreshMemory();
  isMediaAlive.mockResolvedValue(true);
  uploadMedia.mockResolvedValue('new-id');
});

describe('header image', () => {
  it('leaves a working image alone', async () => {
    const out = await ensureTemplateMediaFresh(image(), CFG);
    expect(out.header_media_id).toBe('old-id');
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(updateMediaId).not.toHaveBeenCalled();
  });

  it('rebuilds an expired image from the sample Meta keeps, and stores the new id', async () => {
    isMediaAlive.mockResolvedValue(false);
    getTemplateHeaderExample.mockResolvedValue(sample);
    const out = await ensureTemplateMediaFresh(image(), CFG);
    expect(getTemplateHeaderExample).toHaveBeenCalledWith('tok', 'meta-1');
    expect(uploadMedia).toHaveBeenCalledWith(expect.objectContaining({ phoneNumberId: 'pn1', accessToken: 'tok', buffer: sample.buffer, mimeType: 'image/jpeg', filename: 'header.jpg' }));
    expect(updateMediaId).toHaveBeenCalledWith('t1', 's1', 'new-id');
    expect(out.header_media_id).toBe('new-id');
  });

  it('says so plainly when Meta has no sample to rebuild it from, or the template has no Meta id', async () => {
    isMediaAlive.mockResolvedValue(false);
    getTemplateHeaderExample.mockResolvedValue(null);
    await expect(ensureTemplateMediaFresh(image(), CFG)).rejects.toBeInstanceOf(MediaRefreshError);
    await expect(ensureTemplateMediaFresh(image({ id: 't2', meta_template_id: null }), CFG)).rejects.toThrow(/Re-upload it/);
    expect(uploadMedia).not.toHaveBeenCalled();
  });

  it('does NOT re-upload when Meta is merely unreachable: that error is passed on (and the send retried later)', async () => {
    isMediaAlive.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    await expect(ensureTemplateMediaFresh(image(), CFG)).rejects.toThrow('socket hang up');
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(updateMediaId).not.toHaveBeenCalled();
  });

  it('does not look again for a few hours once an image was found fine', async () => {
    await ensureTemplateMediaFresh(image(), CFG);
    await ensureTemplateMediaFresh(image(), CFG);
    expect(isMediaAlive).toHaveBeenCalledTimes(1);
  });

  it('ignores a template with no media at all', async () => {
    const out = await ensureTemplateMediaFresh(image({ header_type: 'none', header_media_id: null }), CFG);
    expect(out.header_media_id).toBeNull();
    expect(isMediaAlive).not.toHaveBeenCalled();
  });
});

describe('carousel cards', () => {
  const cards = () => [
    { body: 'one', header_media_id: 'c1', buttons: [{ type: 'quick_reply', text: 'A' }] },
    { body: 'two', header_media_id: 'c2', buttons: [{ type: 'quick_reply', text: 'A' }] },
    { body: 'three', header_media_id: 'c3', buttons: [{ type: 'quick_reply', text: 'A' }] },
  ];
  const carousel = (over: object = {}) => image({ header_type: 'none', header_media_id: null, carousel: cards(), ...over });

  it('leaves working cards alone', async () => {
    await ensureTemplateMediaFresh(carousel(), CFG);
    expect(updateCarousel).not.toHaveBeenCalled();
  });

  it('re-uploads only the cards that expired and keeps everything else on each card', async () => {
    isMediaAlive.mockImplementation(async (_t: string, id: string) => id !== 'c2');
    getTemplateCarouselExamples.mockResolvedValue([sample, sample, sample]);
    const out = await ensureTemplateMediaFresh(carousel(), CFG);
    expect(uploadMedia).toHaveBeenCalledTimes(1);
    expect(uploadMedia).toHaveBeenCalledWith(expect.objectContaining({ filename: 'card2.jpg' }));
    const stored = updateCarousel.mock.calls[0][2];
    expect(stored.map((c: any) => c.header_media_id)).toEqual(['c1', 'new-id', 'c3']);
    expect(stored[1]).toMatchObject({ body: 'two', buttons: [{ type: 'quick_reply', text: 'A' }] });
    expect(out.carousel).toEqual(stored);
  });

  it('refuses (rather than send a broken carousel) when an expired card has no sample', async () => {
    isMediaAlive.mockImplementation(async (_t: string, id: string) => id !== 'c3');
    getTemplateCarouselExamples.mockResolvedValue([sample, sample, null]);
    await expect(ensureTemplateMediaFresh(carousel(), CFG)).rejects.toThrow(/Carousel card 3/);
    expect(updateCarousel).not.toHaveBeenCalled();
  });
});
