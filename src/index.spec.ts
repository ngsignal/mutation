import * as mainEntry from './index';

// The main entry must not load the Observable/HttpClient variants: they import `rxjs`
// operators missing from RxJS 6 and `@angular/common/http`, both optional peers.
vi.mock('./rx-mutation.js', () => {
  throw new Error('the main entry must not import rx-mutation');
});
vi.mock('./http-mutation.js', () => {
  throw new Error('the main entry must not import http-mutation');
});

describe('main entry point', () => {
  it('only exposes mutation()', () => {
    expect(Object.keys(mainEntry)).toEqual(['mutation']);
  });
});
